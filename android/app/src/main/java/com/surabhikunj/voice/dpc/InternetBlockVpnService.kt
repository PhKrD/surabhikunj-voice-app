package com.surabhikunj.voice.dpc

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.FileDescriptor
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * InternetBlockVpnService
 *
 * A local VPN with two independent modes, both built on the same
 * VpnService/TUN mechanism, so only one ever needs to hold the single
 * VPN session Android allows an app at a time:
 *
 *   MODE_BLOCK_ALL — captures ALL device traffic and silently drops it,
 *     used for pause_internet / block_internet schedules. Unchanged from
 *     the original implementation.
 *
 *   MODE_DNS_FILTER — OPT-IN, OFF BY DEFAULT (see
 *     pc_website_filter_settings.use_vpn). Domain-level blocking that also
 *     covers non-browser apps and browsers whose address bar we can't
 *     read. The DEFAULT website-filtering path needs none of this: it's
 *     VoiceKidsAccessibilityService reading the browser URL and blocking
 *     the page (see WebPolicy.kt). A parent only turns this on to close
 *     the "used an app instead of a browser" gap, knowing it puts every
 *     DNS lookup on the device through us. Only DNS-port UDP traffic (plus a short list
 *     of known public DoH resolver IPs, on any port, so we can drop their
 *     non-DNS-port traffic too — see KNOWN_DOH_IPS below) is ever routed
 *     into this VPN at all; everything else — every other IP, every
 *     other port — bypasses the tunnel completely and is untouched. This
 *     is the same "DNS-only local VPN" technique apps like DNS66/AdGuard
 *     use, chosen deliberately over a full drop-everything tunnel so
 *     normal browsing/streaming/etc. is unaffected except for the
 *     specific blocked domains.
 *
 *     Blocked domains get an immediate synthetic NXDOMAIN reply (built by
 *     DnsFilterEngine, no real network round-trip). Everything else is
 *     forwarded to a real public resolver (Cloudflare 1.1.1.1) via a
 *     plain socket that automatically bypasses this same VPN (our own
 *     app is addDisallowedApplication()-exempted below) and the reply is
 *     relayed back verbatim.
 *
 *     HONEST LIMITATION: a browser hardwired to use its OWN DNS-over-HTTPS
 *     resolver (e.g. Chrome/Firefox defaulting to Cloudflare/Google DoH)
 *     ignores the system DNS server entirely, bypassing this filter. We
 *     mitigate this by also routing KNOWN_DOH_IPS into the tunnel and
 *     dropping any non-port-53 traffic to them outright (forcing that
 *     specific DoH connection to fail closed, which makes well-behaved
 *     browsers fall back to system DNS — which we do filter). This is
 *     best-effort, not exhaustive: a resolver IP outside this short list
 *     is not intercepted at all. Document this to parents; never claim
 *     "guaranteed" website blocking.
 *
 * IMPORTANT — no startForeground() call here: see the original doc
 * comment below (VpnService auto-promotes itself once a VPN interface is
 * established; calling startForeground() ourselves would need a
 * foregroundServiceType and crashes on API 34+ for VPN).
 */
class InternetBlockVpnService : VpnService() {

    private var vpnInterface: ParcelFileDescriptor? = null
    @Volatile private var running = false
    @Volatile private var mode: String = MODE_BLOCK_ALL
    private var dnsDispatchExecutor: ExecutorService? = null

    companion object {
        private const val TAG = "VoiceKidsVPN"
        const val MODE_BLOCK_ALL = "block_all"
        const val MODE_DNS_FILTER = "dns_filter"
        private const val EXTRA_MODE = "mode"

        private const val FAKE_DNS_IP = "10.200.200.1"
        private const val UPSTREAM_TIMEOUT_MS = 3000

        // Only used when the underlying network's own resolvers are
        // unreadable or all fail — see upstreamResolvers().
        private val PUBLIC_FALLBACK_DNS = listOf("1.1.1.1", "8.8.8.8", "9.9.9.9")

        // Known public DoH/DoT resolver IPs. Routed into our tunnel ONLY so
        // we can drop their non-DNS-port (443/853) traffic outright — see
        // the class doc comment's "HONEST LIMITATION" above. Plain port-53
        // traffic to any of these still works normally (proxied/filtered
        // like any other DNS query); this list is best-effort, not
        // exhaustive.
        private val KNOWN_DOH_IPS = listOf(
            "1.1.1.1", "1.0.0.1",               // Cloudflare
            "8.8.8.8", "8.8.4.4",               // Google
            "9.9.9.9", "149.112.112.112",       // Quad9
            "208.67.222.222", "208.67.220.220", // OpenDNS
        )

        fun start(context: Context, mode: String = MODE_BLOCK_ALL) {
            val intent = Intent(context, InternetBlockVpnService::class.java).putExtra(EXTRA_MODE, mode)
            // Plain startService() — VpnService handles its own foreground state
            // once Builder.establish() succeeds; startForegroundService() is NOT
            // needed here and would require a foregroundServiceType on API 34+.
            context.startService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, InternetBlockVpnService::class.java))
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val requestedMode = intent?.getStringExtra(EXTRA_MODE) ?: MODE_BLOCK_ALL
        if (running && requestedMode != mode) {
            // Mode switch (e.g. a block_internet schedule starts while the
            // DNS filter was running) — tear down and re-establish under
            // the new mode rather than trying to mutate a live TUN.
            stopVpn()
        }
        mode = requestedMode
        startVpn()
        return START_STICKY
    }

    private fun startVpn() {
        if (running) return
        try {
            val builder = Builder()
                .addAddress(FAKE_DNS_IP, 32)
                // Our own app bypasses the VPN entirely so the monitoring
                // service keeps Supabase connectivity, receives commands,
                // and our own DNS-forwarding socket (MODE_DNS_FILTER) never
                // loops back through the tunnel it created.
                .addDisallowedApplication(packageName)

            if (mode == MODE_DNS_FILTER) {
                builder.setSession("VOICE — Website filtering")
                    .setMtu(1500)
                    .addDnsServer(FAKE_DNS_IP)
                    .addRoute(FAKE_DNS_IP, 32)
                KNOWN_DOH_IPS.forEach { ip ->
                    try { builder.addRoute(ip, 32) } catch (e: Exception) { /* duplicate/invalid — ignore, best-effort list */ }
                }
            } else {
                builder.setSession("VOICE — Internet Paused")
                    .addRoute("0.0.0.0", 0)
                    .addRoute("::", 0)
            }

            vpnInterface = builder.establish() ?: run {
                Log.e(TAG, "VPN establish() returned null — VPN permission not granted yet")
                stopSelf()
                return
            }

            running = true
            Log.i(TAG, "VPN started in mode=$mode")

            val fd = vpnInterface!!.fileDescriptor
            Thread {
                if (mode == MODE_DNS_FILTER) runDnsFilterLoop(fd) else runDropAllLoop(fd)
            }.apply { isDaemon = true; start() }

        } catch (e: Exception) {
            Log.e(TAG, "startVpn failed: ${e.message}")
            stopSelf()
        }
    }

    /** MODE_BLOCK_ALL: read and discard every packet — no forwarding == no internet for any captured app. */
    private fun runDropAllLoop(fd: FileDescriptor) {
        val buf = ByteArray(32_767)
        val stream = FileInputStream(fd)
        try {
            while (running) {
                val n = stream.read(buf)
                if (n < 0) break
                // Intentionally discard — drop the packet
            }
        } catch (e: IOException) {
            // Normal when vpnInterface.close() is called from stopVpn()
        }
        Log.i(TAG, "drop-all drain thread finished")
    }

    /** MODE_DNS_FILTER: the only packets that ever arrive here are DNS-port UDP (or non-DNS traffic to a KNOWN_DOH_IPS entry, which we intentionally drop by never forwarding it). */
    private fun runDnsFilterLoop(fd: FileDescriptor) {
        val input = FileInputStream(fd)
        val output = FileOutputStream(fd)
        val buf = ByteArray(32_767)
        // Each query is forwarded on its own worker so one slow/unresponsive
        // upstream lookup never stalls reading the NEXT packet off the tun —
        // real browsing fires many DNS lookups back-to-back.
        val executor = Executors.newFixedThreadPool(4)
        dnsDispatchExecutor = executor
        try {
            while (running) {
                val n = input.read(buf)
                if (n < 0) break
                val packet = buf.copyOf(n)
                try {
                    handleDnsPacket(packet, output, executor)
                } catch (e: Exception) {
                    Log.w(TAG, "handleDnsPacket error: ${e.message}")
                }
            }
        } catch (e: IOException) {
            // Normal when vpnInterface.close() is called from stopVpn()
        } finally {
            executor.shutdownNow()
            dnsDispatchExecutor = null
        }
        Log.i(TAG, "dns-filter loop finished")
    }

    private fun handleDnsPacket(buf: ByteArray, output: FileOutputStream, executor: ExecutorService) {
        val datagram = DnsFilterEngine.parseIpv4Udp(buf, buf.size) ?: return
        // Anything other than DNS-port UDP arriving here can only be
        // non-DNS traffic to a KNOWN_DOH_IPS address (that's the only
        // other thing routed into this tunnel) — intentionally dropped by
        // doing nothing, which forces that specific DoH connection closed.
        if (datagram.dstPort != DnsFilterEngine.DNS_PORT) return
        if (datagram.payloadLength < 12) return

        val dnsQuery = buf.copyOfRange(datagram.payloadOffset, datagram.payloadOffset + datagram.payloadLength)
        val domain = DnsFilterEngine.extractQuestionName(dnsQuery, dnsQuery.size)

        if (domain != null) {
            when (WebPolicy.evaluate(applicationContext, domain)) {
                WebPolicy.Verdict.BLOCK -> {
                    Log.i(TAG, "DNS blocked: $domain")
                    writePacket(output, DnsFilterEngine.buildBlockedResponsePacket(datagram, dnsQuery, dnsQuery.size))
                    maybeAlertBlocked(domain)
                    return
                }
                // 'alert' action: resolve normally, but tell the parent.
                WebPolicy.Verdict.ALERT -> maybeAlertVisited(domain)
                WebPolicy.Verdict.ALLOW -> Unit
            }

            if (VoiceKidsPrefs.enforceSafeSearch(applicationContext)) {
                val alias = WebPolicy.safeSearchAliasFor(domain)
                if (alias != null) {
                    if (DnsFilterEngine.extractQuestionType(dnsQuery, dnsQuery.size) != DnsFilterEngine.TYPE_A) {
                        writePacket(output, DnsFilterEngine.buildNoDataPacket(datagram, dnsQuery, dnsQuery.size))
                    } else {
                        executor.execute { forwardSafeSearch(datagram, dnsQuery, output, domain, alias) }
                    }
                    return
                }
            }
        }

        executor.execute { forwardToUpstream(datagram, dnsQuery, output, domain) }
    }

    /** Resolves the safe-search alias hostname and answers the original query with ITS ip — see DnsFilterEngine.buildSafeSearchResponsePacket. */
    private fun forwardSafeSearch(datagram: DnsFilterEngine.UdpDatagram, dnsQuery: ByteArray, output: FileOutputStream, domain: String, alias: String) {
        try {
            // Our own app is excluded from this VPN's routing (see Builder
            // setup below), so this plain resolution goes out over the
            // normal system network path, not back into the tunnel.
            val resolved = InetAddress.getByName(alias).address
            if (resolved.size != 4) { // IPv6 alias result — fall back to a real answer rather than guess-truncate
                forwardToUpstream(datagram, dnsQuery, output, domain)
                return
            }
            val response = DnsFilterEngine.buildSafeSearchResponsePacket(datagram, dnsQuery, dnsQuery.size, resolved)
            writePacket(output, response)
        } catch (e: Exception) {
            Log.w(TAG, "Safe search resolve failed for $domain -> $alias: ${e.message}")
            forwardToUpstream(datagram, dnsQuery, output, domain)
        }
    }

    /** Rate-limited (per-domain, 30 min) pc_alerts insert for the 'alert' web-filter action (allowed, but the parent is told). */
    private fun maybeAlertVisited(domain: String) {
        val now = System.currentTimeMillis()
        if (now - VoiceKidsPrefs.lastWebsiteVisitAlertAt(applicationContext, domain) < 30 * 60_000L) return
        VoiceKidsPrefs.setLastWebsiteVisitAlertAt(applicationContext, domain, now)

        val deviceId = VoiceKidsPrefs.deviceId(applicationContext) ?: return
        val childId = VoiceKidsPrefs.childId(applicationContext) ?: return
        val row = org.json.JSONObject().apply {
            put("device_id", deviceId)
            put("child_id", childId)
            put("alert_type", "website_alert")
            put("severity", "info")
            put("title", "Visited a flagged website")
            put("body", "Opened $domain (allowed, flagged for your attention).")
            put("metadata", org.json.JSONObject().put("domain", domain))
        }
        dnsDispatchExecutor?.execute { SupabaseRest.insert(applicationContext, "pc_alerts", row) }
            ?: SupabaseRest.insert(applicationContext, "pc_alerts", row)
    }

    /** Rate-limited (per-domain, 15 min) pc_alerts insert when alert_on_block is enabled — see pc_website_filter_settings. */
    private fun maybeAlertBlocked(domain: String) {
        if (!VoiceKidsPrefs.alertOnWebsiteBlock(applicationContext)) return
        val now = System.currentTimeMillis()
        if (now - VoiceKidsPrefs.lastWebsiteBlockAlertAt(applicationContext, domain) < 15 * 60_000L) return
        VoiceKidsPrefs.setLastWebsiteBlockAlertAt(applicationContext, domain, now)

        val deviceId = VoiceKidsPrefs.deviceId(applicationContext) ?: return
        val childId = VoiceKidsPrefs.childId(applicationContext) ?: return
        val row = org.json.JSONObject().apply {
            put("device_id", deviceId)
            put("child_id", childId)
            put("alert_type", "website_blocked")
            put("severity", "info")
            put("title", "Blocked website attempt")
            put("body", "Tried to visit a blocked website: $domain")
            put("metadata", org.json.JSONObject().put("domain", domain))
        }
        // Off the DNS read loop — a blocking HTTP insert there would stall
        // every other DNS answer for the duration of the request.
        dnsDispatchExecutor?.execute { SupabaseRest.insert(applicationContext, "pc_alerts", row) }
            ?: SupabaseRest.insert(applicationContext, "pc_alerts", row)
    }

    private fun forwardToUpstream(datagram: DnsFilterEngine.UdpDatagram, dnsQuery: ByteArray, output: FileOutputStream, domain: String?) {
        for (upstream in upstreamResolvers()) {
            val reply = queryUpstream(upstream, dnsQuery) ?: continue
            writePacket(output, DnsFilterEngine.buildForwardedResponsePacket(datagram, reply))
            return
        }
        // Every resolver failed. Answer SERVFAIL instead of dropping so the
        // client gives up immediately rather than stalling on each lookup —
        // "no site loads and nothing says why" is exactly what silent drops
        // look like to a child.
        Log.w(TAG, "All upstream resolvers failed for domain=$domain")
        writePacket(output, DnsFilterEngine.buildServFailPacket(datagram, dnsQuery, dnsQuery.size))
    }

    private fun queryUpstream(upstream: InetAddress, dnsQuery: ByteArray): ByteArray? = try {
        DatagramSocket().use { socket ->
            socket.soTimeout = UPSTREAM_TIMEOUT_MS
            socket.send(DatagramPacket(dnsQuery, dnsQuery.size, upstream, DnsFilterEngine.DNS_PORT))
            // 4096, not 1500: with EDNS0 a legitimate answer routinely
            // exceeds one MTU, and a short buffer silently TRUNCATES the
            // datagram, handing the client a malformed reply it can only
            // fail on. This was breaking large/CDN-heavy sites at random.
            val replyBuf = ByteArray(4096)
            val reply = DatagramPacket(replyBuf, replyBuf.size)
            socket.receive(reply)
            replyBuf.copyOf(reply.length)
        }
    } catch (e: Exception) {
        Log.w(TAG, "Upstream ${upstream.hostAddress} failed: ${e.message}")
        null
    }

    /**
     * The resolvers to forward to, best first: whatever the UNDERLYING
     * network handed the device (captured before/outside our tunnel, via
     * the non-VPN active network's LinkProperties), then the public
     * fallbacks. Using only a hardcoded public resolver breaks browsing
     * outright on any network that blocks it — captive portals, some
     * schools and a fair number of ISPs — and on split-horizon networks
     * it can't resolve internal names at all.
     */
    private fun upstreamResolvers(): List<InetAddress> {
        val out = LinkedHashSet<InetAddress>()
        try {
            val cm = getSystemService(ConnectivityManager::class.java)
            cm?.allNetworks?.forEach { network ->
                val caps = cm.getNetworkCapabilities(network) ?: return@forEach
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return@forEach
                if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return@forEach
                cm.getLinkProperties(network)?.dnsServers?.forEach { dns ->
                    // IPv4 only — our TUN carries no IPv6 route, so an IPv6
                    // resolver is unreachable from this socket.
                    if (dns.address.size == 4 && !dns.isLoopbackAddress) out.add(dns)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not read system DNS servers: ${e.message}")
        }
        PUBLIC_FALLBACK_DNS.forEach { ip ->
            try { out.add(InetAddress.getByName(ip)) } catch (_: Exception) {}
        }
        return out.toList()
    }

    private fun writePacket(output: FileOutputStream, packet: ByteArray) {
        synchronized(output) {
            try {
                output.write(packet)
            } catch (e: IOException) {
                // Normal if the VPN was torn down between the read and this write.
            }
        }
    }

    private fun stopVpn() {
        running = false
        dnsDispatchExecutor?.shutdownNow()
        try { vpnInterface?.close() } catch (_: Exception) {}
        vpnInterface = null
        Log.i(TAG, "VPN stopped (mode=$mode) — restored")
    }

    override fun onDestroy() {
        stopVpn()
        super.onDestroy()
    }

    /** Called by the OS when a higher-priority VPN takes over (e.g. user installs their own). */
    override fun onRevoke() {
        stopVpn()
        super.onRevoke()
    }
}
