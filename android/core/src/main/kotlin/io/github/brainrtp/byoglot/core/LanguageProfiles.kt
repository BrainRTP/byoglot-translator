package io.github.brainrtp.byoglot.core

import java.util.Locale

object LanguageProfiles {
    fun primaryLang(code: String): String = code.split('-', '_').first().lowercase(Locale.ROOT)

    fun profileId(profile: String, targetLang: String, builtins: Map<String, String>): String {
        val primary = primaryLang(targetLang)
        val choice =
            if (profile == Contracts.GENERIC_PROFILE || profile == primary) profile else "auto"
        return if (choice in builtins) choice
        else if (primary in builtins) primary else Contracts.GENERIC_PROFILE
    }

    fun text(
        enabled: Boolean,
        profile: String,
        targetLang: String,
        builtins: Map<String, String>,
        overrides: Map<String, ProfileOverride>,
    ): String {
        if (!enabled) return ""
        val id = profileId(profile, targetLang, builtins)
        val builtin = builtins[id] ?: ""
        val override = overrides[id]
        return if (override != null && override.text.jsTrim() != builtin.jsTrim()) override.text
        else builtin
    }
}
