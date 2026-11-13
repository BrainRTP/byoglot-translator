package io.github.brainrtp.byoglot.core

fun String.jsTrim(): String = trim {
    it in '\u0009'..'\u000D' ||
        it == '\u0020' ||
        it == '\u00A0' ||
        it == '\u1680' ||
        it in '\u2000'..'\u200A' ||
        it == '\u2028' ||
        it == '\u2029' ||
        it == '\u202F' ||
        it == '\u205F' ||
        it == '\u3000' ||
        it == '\uFEFF'
}
