package expo.modules.twowayaudio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/** Keeps an explicitly started voice conversation alive when the screen locks. */
class VoiceCaptureService : Service() {
    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        val channelId = "fde_voice_capture"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(NotificationChannel(channelId, "Voice conversation", NotificationManager.IMPORTANCE_LOW))
        }
        val stop = PendingIntent.getService(this, 0, Intent(this, VoiceCaptureService::class.java).setAction("stop"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, channelId) else Notification.Builder(this)
        val notification = builder.setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Voice conversation active")
            .setContentText("Microphone is in use")
            .setOngoing(true)
            .addAction(Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "End", stop).build())
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(4281, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        else startForeground(4281, notification)
        active = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop") {
            ExpoTwoWayAudioModule.audioEngine?.let { engine ->
                engine.toggleRecording(false)
                engine.stopPlayback()
                engine.releaseAudioSession()
                engine.onAudioInterruptionCallback?.invoke("blocked")
            }
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() { active = false; requested = false; super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null
    companion object {
        @Volatile var requested = false
        @Volatile var active = false
    }
}
