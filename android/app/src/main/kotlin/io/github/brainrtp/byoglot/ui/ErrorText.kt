package io.github.brainrtp.byoglot.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import io.github.brainrtp.byoglot.R
import io.github.brainrtp.byoglot.core.*

fun errorText(error: RunnerError): Int = when (error) {
    RunnerError.NoConnection -> R.string.error_no_connection
    RunnerError.NoModel -> R.string.error_no_model
    RunnerError.KeyMissing -> R.string.error_key_missing
    is RunnerError.ConsentNeeded -> R.string.error_consent
    is RunnerError.TooLong -> R.string.error_too_long
    RunnerError.Empty -> R.string.error_empty
    RunnerError.LocalNetworkDenied -> R.string.error_local_network
    is RunnerError.Backend -> when (error.error.kind) {
        ErrorKind.Offline -> R.string.error_offline
        ErrorKind.ProviderAuth, ErrorKind.Unauthorized -> R.string.error_auth
        ErrorKind.RateLimit -> R.string.error_rate_limit
        else -> R.string.error_provider
    }
}
@Composable
fun errorMessage(error: RunnerError): String = when (error) {
    is RunnerError.ConsentNeeded -> stringResource(errorText(error), error.origin)
    is RunnerError.TooLong -> stringResource(errorText(error), error.limit)
    is RunnerError.Backend -> when (error.error.kind) {
        ErrorKind.ProviderAuth, ErrorKind.Unauthorized -> stringResource(errorText(error), error.error.status ?: 401)
        ErrorKind.Offline, ErrorKind.RateLimit -> stringResource(errorText(error))
        else -> stringResource(errorText(error), error.error.kind.wire)
    }
    else -> stringResource(errorText(error))
}
fun errorDestination(error: RunnerError): String? = when (error) {
    RunnerError.NoConnection, RunnerError.NoModel, RunnerError.KeyMissing, is RunnerError.ConsentNeeded -> "connections"
    RunnerError.LocalNetworkDenied -> "network"
    is RunnerError.Backend -> if (error.error.kind in listOf(ErrorKind.ProviderAuth, ErrorKind.Unauthorized)) "connections" else null
    else -> null
}
