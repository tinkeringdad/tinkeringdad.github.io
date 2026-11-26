package com.tinkeringdad.plaintv;

import java.util.ArrayDeque;

/**
 * In-memory notes shown on the Plain TV settings screen, to help work out what a
 * particular remote and TV send. Nothing is saved or sent anywhere.
 */
final class Diag {
    private Diag() {}

    /** True while Plain search is waiting for the voice typing screen to answer. */
    static volatile boolean voicePending;
    /** When voice typing last started or finished (elapsedRealtime). */
    static volatile long voiceChangedAt;

    static boolean voiceBusy(long now) {
        return voicePending || now - voiceChangedAt < 4000;
    }

    private static final ArrayDeque<String> keys = new ArrayDeque<>();
    private static final ArrayDeque<String> windows = new ArrayDeque<>();

    static synchronized void key(String k) { push(keys, k); }

    static synchronized void window(String pkg) {
        if (!windows.isEmpty() && windows.peekFirst().equals(pkg)) return;
        push(windows, pkg);
    }

    private static void push(ArrayDeque<String> q, String s) {
        q.addFirst(s);
        while (q.size() > 6) q.removeLast();
    }

    static synchronized String summary() {
        return "Buttons: " + (keys.isEmpty() ? "none yet" : String.join(", ", keys))
                + "\nApps opened: " + (windows.isEmpty() ? "none yet" : String.join(", ", windows));
    }
}
