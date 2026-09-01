package com.surabhikunj.voice;

import com.getcapacitor.BridgeActivity;
import com.surabhikunj.voice.dpc.VoiceKidsDpcPlugin;
import com.surabhikunj.voice.dpc.VoiceKidsLocationPlugin;
import com.surabhikunj.voice.dpc.VoiceKidsUsageStatsPlugin;

public class MainActivity extends BridgeActivity {
    // Device Policy Controller bridges (parental control). Registered
    // unconditionally — they are inert no-ops unless this device has
    // actually been set up in "I am a Child" mode and provisioned as
    // Device Owner (see VoiceKidsDpcPlugin.runDeviceOwnerAction()).
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(VoiceKidsDpcPlugin.class);
        registerPlugin(VoiceKidsLocationPlugin.class);
        registerPlugin(VoiceKidsUsageStatsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
