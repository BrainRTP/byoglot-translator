package io.github.brainrtp.byoglot.ui

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import io.github.brainrtp.byoglot.core.ModelRef

internal val ModelDraftSaver =
    Saver<MutableState<ModelRef?>, List<String>>(
        save = { state ->
            state.value
                ?.let {
                    listOf(it.providerID, it.id, it.variant.orEmpty(), it.connectionId.orEmpty())
                }
                .orEmpty()
        },
        restore = { fields ->
            mutableStateOf(
                if (fields.isEmpty()) null
                else
                    ModelRef(
                        fields[0],
                        fields[1],
                        fields[2].ifEmpty { null },
                        fields[3].ifEmpty { null },
                    ),
            )
        },
    )
