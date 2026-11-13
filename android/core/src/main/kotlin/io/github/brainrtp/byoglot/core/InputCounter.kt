package io.github.brainrtp.byoglot.core

data class InputCounter(val count: Int, val limit: Int) {
    val overLimit: Boolean
        get() = count > limit

    companion object {
        fun editor(text: String) = InputCounter(text.length, EDITOR_INPUT_LIMIT)
    }
}
