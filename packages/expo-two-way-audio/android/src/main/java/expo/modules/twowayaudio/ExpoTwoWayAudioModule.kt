package expo.modules.twowayaudio

import AudioEngine
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.interfaces.permissions.Permissions

class ExpoTwoWayAudioModule : Module() {
    private var ownedEngine: AudioEngine? = null
    companion object {
        private const val ON_MIC_DATA_EVENT = "onMicrophoneData"
        private const val ON_INPUT_VOLUME_LEVEL_EVENT = "onInputVolumeLevelData"
        private const val ON_OUTPUT_VOLUME_LEVEL_EVENT = "onOutputVolumeLevelData"
        private const val ON_RECORDING_CHANGE_EVENT = "onRecordingChange"
        private const val ON_AUDIO_INTERRUPTION_EVENT = "onAudioInterruption"
        @Volatile var audioEngine: AudioEngine? = null
    }

    override fun definition() = ModuleDefinition {
        Name("ExpoTwoWayAudio")
        AsyncFunction("initialize") { promise: Promise ->
            synchronized(ExpoTwoWayAudioModule::class.java) {
                try {
                    if (audioEngine != null) {
                        promise.resolve(true)
                        return@AsyncFunction
                    }
                    val context = appContext.reactContext
                        ?: throw IllegalStateException("React context is unavailable")
                    audioEngine = AudioEngine(context).also { ownedEngine = it }
                    setupCallbacks()
                    promise.resolve(true)
                } catch (e: Exception) {
                    promise.resolve(false)
                }
            }
        }

         Function("releaseAudioSession") {
             audioEngine?.releaseAudioSession()
             null
         }

         Function("isRecording") {
             audioEngine?.isRecording ?: false
         }

         Function("toggleRecording") { value: Boolean ->
             audioEngine?.let { engine ->
                 val isRecording = engine.toggleRecording(value)
                 sendEvent(ON_RECORDING_CHANGE_EVENT, mapOf("data" to isRecording))
                 isRecording
             } ?: false
         }

         Function("tearDown") {
             synchronized(ExpoTwoWayAudioModule::class.java) {
                 audioEngine?.tearDown()
                 audioEngine = null
                 ownedEngine = null
             }
             null
         }

         Function("restart") {
             audioEngine?.resumeRecordingAndPlayer()
             sendEvent(ON_RECORDING_CHANGE_EVENT, mapOf(
                 "data" to (audioEngine?.isRecording ?: false)
             ))
         }

         Function("playPCMData") { data: kotlin.ByteArray ->
             audioEngine?.playPCMData(data)
         }

         Function("bypassVoiceProcessing") { bypass: Boolean ->
             audioEngine?.bypassVoiceProcessing(bypass)
         }

         Function("isPlaying") {
             audioEngine?.isPlaying ?: false
         }

         Function("stopPlayback") {
             audioEngine?.stopPlayback()
         }

         Function("pausePlayback") {
             audioEngine?.pausePlayback()
         }

         Function("resumePlayback") {
             audioEngine?.resumePlayback()
         }

        Function("getMicrophoneModeIOS") {
            throw UnsupportedOperationException("getMicrophoneModeIOS is only supported on iOS")
        }

        Function ("setMicrophoneModeIOS") {
            throw UnsupportedOperationException("setMicrophoneModeIOS is only supported on iOS")
        }

         AsyncFunction("getMicrophonePermissionsAsync") { promise: Promise ->
             Permissions.getPermissionsWithPermissionsManager(
                 appContext.permissions,
                 promise,
                 android.Manifest.permission.RECORD_AUDIO
             )
         }

         AsyncFunction("requestMicrophonePermissionsAsync") { promise: Promise ->
             Permissions.askForPermissionsWithPermissionsManager(
                 appContext.permissions,
                 promise,
                 android.Manifest.permission.RECORD_AUDIO
             )
         }

        OnDestroy {
            // Only the module that created this singleton owns teardown. A stale
            // module destruction must not release a replacement engine.
            synchronized(ExpoTwoWayAudioModule::class.java) {
                ownedEngine?.let { engine ->
                    engine.tearDown()
                    if (audioEngine === engine) audioEngine = null
                }
                ownedEngine = null
            }
        }

        // Register events
        Events(
            ON_MIC_DATA_EVENT,
            ON_INPUT_VOLUME_LEVEL_EVENT,
            ON_OUTPUT_VOLUME_LEVEL_EVENT,
            ON_RECORDING_CHANGE_EVENT,
            ON_AUDIO_INTERRUPTION_EVENT
        )
    }

    private fun setupCallbacks() {
        audioEngine?.apply {
            onMicDataCallback = { data ->
                sendEvent(ON_MIC_DATA_EVENT, bundleOf("data" to data))
            }
            onInputVolumeCallback = { level ->
                sendEvent(ON_INPUT_VOLUME_LEVEL_EVENT, bundleOf("data" to level))
            }
            onOutputVolumeCallback = { level ->
                sendEvent(ON_OUTPUT_VOLUME_LEVEL_EVENT, bundleOf("data" to level))
            }
            onAudioInterruptionCallback = { data ->
                sendEvent(ON_AUDIO_INTERRUPTION_EVENT, bundleOf("data" to data))
                sendEvent(ON_RECORDING_CHANGE_EVENT, bundleOf(
                    "data" to (audioEngine?.isRecording ?: false)
                ))
            }
        }
    }
}