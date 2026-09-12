package expo.modules.twowayaudio

import android.app.Activity
import expo.modules.core.interfaces.ReactActivityLifecycleListener

class ExpoTwoWayAudioLifeCycleListener : ReactActivityLifecycleListener {
    override fun onPause(activity: Activity?) {
        super.onPause(activity)
        // An explicit voice conversation owns a foreground service.
        if (!VoiceCaptureService.active && !VoiceCaptureService.requested) ExpoTwoWayAudioModule.audioEngine?.pauseRecordingAndPlayer()
    }

    override fun onResume(activity: Activity?) {
        super.onResume(activity)
        // Resume only audio that the lifecycle previously paused.
        ExpoTwoWayAudioModule.audioEngine?.resumeRecordingAndPlayer()
    }
}
