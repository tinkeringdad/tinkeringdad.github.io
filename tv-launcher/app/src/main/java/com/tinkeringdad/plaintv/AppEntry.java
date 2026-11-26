package com.tinkeringdad.plaintv;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.drawable.Drawable;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** One launchable app, plus loading of the installed list. */
final class AppEntry {
    final ComponentName component;
    final String label;
    final Drawable banner; // may be null
    final Drawable icon;
    final boolean leanback;

    private AppEntry(ComponentName component, String label, Drawable banner, Drawable icon, boolean leanback) {
        this.component = component;
        this.label = label;
        this.banner = banner;
        this.icon = icon;
        this.leanback = leanback;
    }

    String key() { return component.flattenToString(); }

    Intent launchIntent() {
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(leanback ? Intent.CATEGORY_LEANBACK_LAUNCHER : Intent.CATEGORY_LAUNCHER);
        i.setComponent(component);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        return i;
    }

    /** Every launchable app, in the user's saved order. Includes hidden apps if asked. */
    static List<AppEntry> load(Context c, boolean includeHidden) {
        PackageManager pm = c.getPackageManager();
        Map<String, AppEntry> byPackage = new LinkedHashMap<>();

        // TV apps first: they have proper banners.
        Intent tv = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
        for (ResolveInfo ri : pm.queryIntentActivities(tv, 0)) add(c, pm, ri, true, byPackage);
        // Phone-style apps that were sideloaded, if they have no TV entry.
        Intent phone = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        for (ResolveInfo ri : pm.queryIntentActivities(phone, 0)) add(c, pm, ri, false, byPackage);

        Set<String> hidden = Prefs.hidden(c);
        Map<String, AppEntry> byKey = new HashMap<>();
        List<AppEntry> rest = new ArrayList<>();
        for (AppEntry e : byPackage.values()) {
            if (!includeHidden && hidden.contains(e.key())) continue;
            byKey.put(e.key(), e);
            rest.add(e);
        }
        rest.sort((a, b) -> a.label.compareToIgnoreCase(b.label));

        List<AppEntry> out = new ArrayList<>();
        for (String k : Prefs.order(c)) {
            AppEntry e = byKey.remove(k);
            if (e != null) out.add(e);
        }
        for (AppEntry e : rest) if (byKey.containsKey(e.key())) out.add(e);
        return out;
    }

    private static void add(Context c, PackageManager pm, ResolveInfo ri, boolean leanback, Map<String, AppEntry> into) {
        ActivityInfo ai = ri.activityInfo;
        if (ai == null || into.containsKey(ai.packageName)) return;
        if (ai.packageName.equals(c.getPackageName())) return;
        Drawable banner = null;
        if (leanback) {
            banner = ai.loadBanner(pm);
            if (banner == null) banner = ai.applicationInfo.loadBanner(pm);
        }
        String label = String.valueOf(ri.loadLabel(pm));
        into.put(ai.packageName, new AppEntry(new ComponentName(ai.packageName, ai.name),
                label, banner, ri.loadIcon(pm), leanback));
    }

    boolean matches(String q) {
        return label.toLowerCase(Locale.ROOT).contains(q.toLowerCase(Locale.ROOT));
    }
}
