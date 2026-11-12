package io.github.brainrtp.byoglot.core

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class OriginMismatchException : Exception()
interface SecretStore {
    suspend fun set(secret: String, connectionId: String, origin: String)
    suspend fun secret(connectionId: String, origin: String): String?
    suspend fun has(connectionId: String): Boolean
    suspend fun delete(connectionId: String)
}
class InMemorySecretStore : SecretStore {
    private class Record(val origin: String, val secret: String)
    private val mutex = Mutex()
    private val records = mutableMapOf<String, Record>()
    override suspend fun set(secret: String, connectionId: String, origin: String) { mutex.withLock { records[connectionId] = Record(origin, secret) } }
    override suspend fun secret(connectionId: String, origin: String): String? = mutex.withLock {
        records[connectionId]?.let { if (it.origin != origin) throw OriginMismatchException() else it.secret }
    }
    override suspend fun has(connectionId: String): Boolean = mutex.withLock { connectionId in records }
    override suspend fun delete(connectionId: String) { mutex.withLock { records.remove(connectionId) } }
}
