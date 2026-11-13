package io.github.brainrtp.byoglot

import android.app.Application
import android.content.Context
import io.github.brainrtp.byoglot.core.*
import io.github.brainrtp.byoglot.net.HttpEngineTransport
import io.github.brainrtp.byoglot.store.*

class AppContainer(context: Context) {
    val settings: SettingsRepository = DataStoreSettingsRepository(context)
    val secrets: SecretStore = KeystoreSecretStore(context)
    val transport: HttpTransport = HttpEngineTransport(context)
    val runner = TranslationRunner(settings, secrets, transport)
}
class ByoglotApplication : Application() {
    val container by lazy { AppContainer(this) }
}
