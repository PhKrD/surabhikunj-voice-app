package com.surabhikunj.voice.dpc

import android.util.Log

/**
 * DnsFilterEngine
 *
 * Minimal raw IPv4/UDP/DNS packet parsing + building, used by
 * InternetBlockVpnService's MODE_DNS_FILTER to implement real
 * domain-level website blocking (see PLATFORM_LIMITATIONS.md "Website
 * visit / search monitoring" — this is the enforcement counterpart).
 *
 * This is the same technique local-VPN DNS filters like DNS66/AdGuard use
 * on Android: only DNS-port UDP packets (plus a short list of known
 * public DoH resolver IPs, handled by the caller) are ever routed into
 * our TUN interface at all (see the VpnService.Builder.addRoute() calls
 * in InternetBlockVpnService) — everything else bypasses the VPN
 * entirely and is untouched. We only ever need to understand UDP/DNS,
 * never TCP or any other protocol.
 *
 * IPv4 only (IPv6 DNS is out of scope — see InternetBlockVpnService's
 * doc comment). No IP options support (assumes a 20-byte IPv4 header,
 * true for every DNS client in practice). UDP checksum is deliberately
 * left as 0 ("not computed") on packets we synthesize — legal per RFC
 * 768 for IPv4 — so only the mandatory IPv4 header checksum needs real
 * computation.
 */
object DnsFilterEngine {
    private const val TAG = "VoiceKidsDnsFilter"
    private const val IPV4_HEADER_LEN = 20
    private const val UDP_HEADER_LEN = 8
    const val DNS_PORT = 53

    data class UdpDatagram(
        val srcIp: ByteArray,
        val dstIp: ByteArray,
        val srcPort: Int,
        val dstPort: Int,
        val payloadOffset: Int,
        val payloadLength: Int,
    )

    /** Parses a raw packet read from the TUN fd. Returns null for anything that isn't plain IPv4/UDP with no options. */
    fun parseIpv4Udp(buf: ByteArray, length: Int): UdpDatagram? {
        if (length < IPV4_HEADER_LEN + UDP_HEADER_LEN) return null
        val version = (buf[0].toInt() shr 4) and 0xF
        if (version != 4) return null
        val ihl = (buf[0].toInt() and 0xF) * 4
        if (ihl != IPV4_HEADER_LEN) return null // no IP options support — real DNS clients never send any
        val protocol = buf[9].toInt() and 0xFF
        if (protocol != 17) return null // UDP only

        val srcIp = buf.copyOfRange(12, 16)
        val dstIp = buf.copyOfRange(16, 20)
        val udpOffset = ihl
        val srcPort = readU16(buf, udpOffset)
        val dstPort = readU16(buf, udpOffset + 2)
        val udpLength = readU16(buf, udpOffset + 4)
        val payloadOffset = udpOffset + UDP_HEADER_LEN
        val payloadLength = (udpLength - UDP_HEADER_LEN).coerceAtMost(length - payloadOffset)
        if (payloadLength < 0 || payloadOffset + payloadLength > length) return null

        return UdpDatagram(srcIp, dstIp, srcPort, dstPort, payloadOffset, payloadLength)
    }

    /**
     * Extracts and lower-cases the QNAME from a DNS question section (the
     * FIRST question only — real stub-resolver queries always send
     * exactly one). Returns null for anything malformed/compressed in a
     * way we don't expect from a well-formed outgoing query (compression
     * pointers never appear in the question section of a real query, only
     * in responses, so we don't need to handle them here).
     */
    fun extractQuestionName(dns: ByteArray, length: Int): String? {
        if (length < 12) return null
        val qdcount = readU16(dns, 4)
        if (qdcount < 1) return null
        val sb = StringBuilder()
        var pos = 12
        while (pos < length) {
            val labelLen = dns[pos].toInt() and 0xFF
            if (labelLen == 0) { pos += 1; break }
            if (labelLen and 0xC0 == 0xC0) return null // compression pointer — not expected in a question section
            pos += 1
            if (pos + labelLen > length) return null
            if (sb.isNotEmpty()) sb.append('.')
            sb.append(String(dns, pos, labelLen, Charsets.US_ASCII))
            pos += labelLen
        }
        return if (sb.isEmpty()) null else sb.toString().lowercase()
    }

    /**
     * Builds a synthetic NXDOMAIN DNS response for a blocked query,
     * wrapped in an IPv4/UDP packet addressed back to the original
     * requester (src/dst swapped relative to the query).
     */
    fun buildBlockedResponsePacket(query: UdpDatagram, dnsQuery: ByteArray, dnsQueryLength: Int): ByteArray {
        val dnsResponse = dnsQuery.copyOf(dnsQueryLength)
        // QR=1 (response), keep OPCODE/AA/TC/RD from the query as-is.
        dnsResponse[2] = (dnsResponse[2].toInt() or 0x80).toByte()
        // RCODE=3 (NXDOMAIN), preserve RA/Z bits (always 0 on an outgoing query anyway).
        dnsResponse[3] = ((dnsResponse[3].toInt() and 0xF0) or 0x03).toByte()
        return buildIpv4UdpPacket(
            srcIp = query.dstIp, srcPort = DNS_PORT,
            dstIp = query.srcIp, dstPort = query.srcPort,
            payload = dnsResponse,
        )
    }

    const val TYPE_A = 1

    /** QTYPE of the first question, or null if unreadable. Safe Search only substitutes A records — see buildNoDataPacket. */
    fun extractQuestionType(dns: ByteArray, length: Int): Int? {
        if (length < 12) return null
        var pos = 12
        while (pos < length) {
            val labelLen = dns[pos].toInt() and 0xFF
            if (labelLen == 0) { pos += 1; break }
            if (labelLen and 0xC0 == 0xC0) return null
            pos += 1 + labelLen
        }
        if (pos + 2 > length) return null
        return readU16(dns, pos)
    }

    /**
     * NOERROR with zero answers. Used for the AAAA half of a Safe Search
     * host: we can only substitute an IPv4 alias, and answering an AAAA
     * question with an A record would be malformed, so we tell the client
     * "this name has no IPv6 address" and it falls back to the (filtered)
     * IPv4 answer instead of racing to an unfiltered v6 address.
     */
    fun buildNoDataPacket(query: UdpDatagram, dnsQuery: ByteArray, dnsQueryLength: Int): ByteArray {
        val dnsResponse = dnsQuery.copyOf(dnsQueryLength)
        dnsResponse[2] = (dnsResponse[2].toInt() or 0x80).toByte() // QR=1
        dnsResponse[3] = (dnsResponse[3].toInt() and 0xF0).toByte() // RCODE=0
        writeU16(dnsResponse, 6, 0) // ANCOUNT=0
        return buildIpv4UdpPacket(
            srcIp = query.dstIp, srcPort = DNS_PORT,
            dstIp = query.srcIp, dstPort = query.srcPort,
            payload = dnsResponse,
        )
    }

    /**
     * SERVFAIL (RCODE=2) for a query we could not resolve upstream.
     * Deliberately NOT silence: dropping the packet leaves the client's
     * stub resolver retrying until its own multi-second timeout on every
     * single lookup, which is what "the internet is broken but nothing is
     * blocked" feels like. A real SERVFAIL fails fast and lets the client
     * try its next configured resolver.
     */
    fun buildServFailPacket(query: UdpDatagram, dnsQuery: ByteArray, dnsQueryLength: Int): ByteArray {
        val dnsResponse = dnsQuery.copyOf(dnsQueryLength)
        dnsResponse[2] = (dnsResponse[2].toInt() or 0x80).toByte()
        dnsResponse[3] = ((dnsResponse[3].toInt() and 0xF0) or 0x02).toByte()
        return buildIpv4UdpPacket(
            srcIp = query.dstIp, srcPort = DNS_PORT,
            dstIp = query.srcIp, dstPort = query.srcPort,
            payload = dnsResponse,
        )
    }

    /** Wraps an already-complete DNS response (from the real upstream resolver) back into an IPv4/UDP packet for the original requester. */
    fun buildForwardedResponsePacket(query: UdpDatagram, upstreamResponse: ByteArray): ByteArray =
        buildIpv4UdpPacket(
            srcIp = query.dstIp, srcPort = DNS_PORT,
            dstIp = query.srcIp, dstPort = query.srcPort,
            payload = upstreamResponse,
        )

    /**
     * Builds a synthetic DNS response for `dnsQuery` that answers with a
     * single A record pointing at `resolvedIp` (an already-resolved
     * "safe" alias, e.g. forcesafesearch.google.com's IP), under the
     * ORIGINAL queried name — this is the standard DNS-based Safe Search
     * enforcement technique (same one Google/Bing/DuckDuckGo document for
     * router-level DNS filters). Uses a compression pointer (0xC00C) back
     * to the question name rather than repeating it, which is legal and
     * simpler than re-encoding the labels.
     */
    fun buildSafeSearchResponsePacket(query: UdpDatagram, dnsQuery: ByteArray, dnsQueryLength: Int, resolvedIp: ByteArray): ByteArray {
        val header = dnsQuery.copyOf(12)
        header[2] = (header[2].toInt() or 0x80).toByte() // QR=1 (response); RCODE (byte 3) stays 0 = no error
        writeU16(header, 6, 1) // ANCOUNT=1

        val question = dnsQuery.copyOfRange(12, dnsQueryLength)
        val answer = ByteArray(10 + 4).apply {
            writeU16(this, 0, 0xC00C) // name = pointer to offset 12 (the question name)
            writeU16(this, 2, 1)      // TYPE=A
            writeU16(this, 4, 1)      // CLASS=IN
            writeU32(this, 6, 60)     // TTL=60s — short, so a later disabled-toggle takes effect quickly
            writeU16(this, 10, 4)     // RDLENGTH=4
            System.arraycopy(resolvedIp, 0, this, 12, 4)
        }

        val dnsResponse = header + question + answer
        return buildIpv4UdpPacket(
            srcIp = query.dstIp, srcPort = DNS_PORT,
            dstIp = query.srcIp, dstPort = query.srcPort,
            payload = dnsResponse,
        )
    }

    private var identCounter = 0

    private fun buildIpv4UdpPacket(srcIp: ByteArray, srcPort: Int, dstIp: ByteArray, dstPort: Int, payload: ByteArray): ByteArray {
        val totalLength = IPV4_HEADER_LEN + UDP_HEADER_LEN + payload.size
        val packet = ByteArray(totalLength)

        // ── IPv4 header ──
        packet[0] = 0x45 // version=4, IHL=5 (20 bytes)
        packet[1] = 0    // DSCP/ECN
        writeU16(packet, 2, totalLength)
        val ident = synchronized(this) { identCounter = (identCounter + 1) and 0xFFFF; identCounter }
        writeU16(packet, 4, ident)
        writeU16(packet, 6, 0) // flags/fragment offset — DNS replies are always small enough to not need DF/fragmentation
        packet[8] = 64 // TTL
        packet[9] = 17 // protocol = UDP
        writeU16(packet, 10, 0) // checksum placeholder
        System.arraycopy(srcIp, 0, packet, 12, 4)
        System.arraycopy(dstIp, 0, packet, 16, 4)
        val ipChecksum = checksum(packet, 0, IPV4_HEADER_LEN)
        writeU16(packet, 10, ipChecksum)

        // ── UDP header ──
        val udpOffset = IPV4_HEADER_LEN
        writeU16(packet, udpOffset, srcPort)
        writeU16(packet, udpOffset + 2, dstPort)
        writeU16(packet, udpOffset + 4, UDP_HEADER_LEN + payload.size)
        writeU16(packet, udpOffset + 6, 0) // checksum "not computed" — legal for IPv4 UDP (RFC 768)

        // ── Payload ──
        System.arraycopy(payload, 0, packet, udpOffset + UDP_HEADER_LEN, payload.size)

        return packet
    }

    private fun readU16(buf: ByteArray, offset: Int): Int =
        ((buf[offset].toInt() and 0xFF) shl 8) or (buf[offset + 1].toInt() and 0xFF)

    private fun writeU16(buf: ByteArray, offset: Int, value: Int) {
        buf[offset] = ((value shr 8) and 0xFF).toByte()
        buf[offset + 1] = (value and 0xFF).toByte()
    }

    private fun writeU32(buf: ByteArray, offset: Int, value: Int) {
        buf[offset] = ((value shr 24) and 0xFF).toByte()
        buf[offset + 1] = ((value shr 16) and 0xFF).toByte()
        buf[offset + 2] = ((value shr 8) and 0xFF).toByte()
        buf[offset + 3] = (value and 0xFF).toByte()
    }

    /** Standard Internet checksum (RFC 791) over `length` bytes starting at `offset`. Caller must zero the checksum field first. */
    private fun checksum(buf: ByteArray, offset: Int, length: Int): Int {
        var sum = 0L
        var i = offset
        val end = offset + length
        while (i + 1 < end) {
            sum += readU16(buf, i)
            i += 2
        }
        if (i < end) {
            sum += (buf[i].toInt() and 0xFF) shl 8
        }
        while (sum shr 16 != 0L) {
            sum = (sum and 0xFFFF) + (sum shr 16)
        }
        return sum.toInt().inv() and 0xFFFF
    }

    fun logDebug(msg: String) {
        Log.d(TAG, msg)
    }
}
