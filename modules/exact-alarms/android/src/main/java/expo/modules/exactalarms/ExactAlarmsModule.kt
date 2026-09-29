package expo.modules.exactalarms

import android.app.Activity
import android.app.AlarmManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Exact-alarm access ("Alarms & reminders", Android 12+). expo-notifications
 * checks it before scheduling but doesn't expose it: without it, a scheduled
 * notification falls back to an inexact alarm that can fire late. Android 14+
 * denies it by default on a fresh install and only the user can grant it.
 */
class ExactAlarmsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExactAlarms")

    // The same check expo-notifications makes (ExpoSchedulingDelegate).
    Function<Boolean>("canScheduleExactAlarms") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        true
      } else {
        val alarmManager = appContext.reactContext?.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        alarmManager?.canScheduleExactAlarms() ?: true
      }
    }

    // This app's own "Alarms & reminders" toggle, or its App info page on a
    // device whose Settings lacks that screen. False if neither opened.
    Function<Boolean>("openExactAlarmSettings") {
      val activity = appContext.currentActivity
      if (activity == null) {
        false
      } else {
        val uri = Uri.fromParts("package", activity.packageName, null)
        val intents = buildList {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            add(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, uri))
          }
          add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, uri))
        }
        intents.any { start(activity, it) }
      }
    }
  }

  private fun start(activity: Activity, intent: Intent): Boolean =
    try {
      activity.startActivity(intent)
      true
    } catch (e: ActivityNotFoundException) {
      false
    }
}
