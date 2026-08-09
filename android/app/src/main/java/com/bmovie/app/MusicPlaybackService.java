package com.bmovie.app;

import android.app.PendingIntent;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.Build;

import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.core.app.NotificationCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.MediaStyleNotificationHelper;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class MusicPlaybackService extends MediaSessionService {
    public static final String EVENT_STATE = "com.bmovie.app.MUSIC_PLAYBACK_STATE";
    private static final String ACTION_SET_QUEUE = "com.bmovie.app.music.SET_QUEUE";
    private static final String ACTION_PLAY = "com.bmovie.app.music.PLAY";
    private static final String ACTION_PAUSE = "com.bmovie.app.music.PAUSE";
    private static final String ACTION_SEEK = "com.bmovie.app.music.SEEK";
    private static final String ACTION_PREVIOUS = "com.bmovie.app.music.PREVIOUS";
    private static final String ACTION_NEXT = "com.bmovie.app.music.NEXT";
    private static final String NOTIFICATION_CHANNEL = "bmovie_music_playback";
    private static final int NOTIFICATION_ID = 2401;
    private static final Object PENDING_LOCK = new Object();
    private static PendingQueue pendingQueue;
    private static volatile PlaybackSnapshot latestSnapshot = new PlaybackSnapshot(false, -1, 0, 0, "");

    private ExoPlayer player;
    private MediaSession mediaSession;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable progressTicker = new Runnable() {
        @Override public void run() {
            publishState();
            handler.postDelayed(this, player != null && player.isPlaying() ? 500 : 1200);
        }
    };

    public static final class Track {
        public final String id;
        public final String url;
        public final String title;
        public final String artist;
        public final String album;
        public final String artwork;

        public Track(String id, String url, String title, String artist, String album, String artwork) {
            this.id = id;
            this.url = url;
            this.title = title;
            this.artist = artist;
            this.album = album;
            this.artwork = artwork;
        }
    }

    private static final class PendingQueue {
        final List<Track> tracks;
        final int index;
        final long positionMs;
        final boolean autoplay;

        PendingQueue(List<Track> tracks, int index, long positionMs, boolean autoplay) {
            this.tracks = tracks;
            this.index = index;
            this.positionMs = positionMs;
            this.autoplay = autoplay;
        }
    }

    public static final class PlaybackSnapshot {
        public final boolean playing;
        public final int index;
        public final long positionMs;
        public final long durationMs;
        public final String mediaId;

        PlaybackSnapshot(boolean playing, int index, long positionMs, long durationMs, String mediaId) {
            this.playing = playing;
            this.index = index;
            this.positionMs = positionMs;
            this.durationMs = durationMs;
            this.mediaId = mediaId;
        }
    }

    @Override public void onCreate() {
        super.onCreate();
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .setUsage(C.USAGE_MEDIA)
            .build();
        player = new ExoPlayer.Builder(this).build();
        player.setAudioAttributes(audioAttributes, true);
        player.setHandleAudioBecomingNoisy(true);
        player.addListener(new Player.Listener() {
            @Override public void onEvents(Player player, Player.Events events) {
                if (events.containsAny(
                    Player.EVENT_IS_PLAYING_CHANGED,
                    Player.EVENT_PLAYBACK_STATE_CHANGED,
                    Player.EVENT_MEDIA_ITEM_TRANSITION,
                    Player.EVENT_POSITION_DISCONTINUITY,
                    Player.EVENT_PLAY_WHEN_READY_CHANGED
                )) {
                    publishState();
                    showPlaybackNotification();
                }
            }
        });

        Intent launchIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent sessionActivity = PendingIntent.getActivity(
            this,
            41,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        mediaSession = new MediaSession.Builder(this, player)
            .setSessionActivity(sessionActivity)
            .build();
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildPlaybackNotification());
        handler.post(progressTicker);
    }

    @Nullable
    @Override public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override public void onUpdateNotification(MediaSession session, boolean startInForegroundRequired) {
        showPlaybackNotification();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        int result = super.onStartCommand(intent, flags, startId);
        if (intent == null || intent.getAction() == null) return result;
        switch (intent.getAction()) {
            case ACTION_SET_QUEUE:
                applyPendingQueue();
                break;
            case ACTION_PLAY:
                player.play();
                break;
            case ACTION_PAUSE:
                player.pause();
                break;
            case ACTION_SEEK:
                player.seekTo(Math.max(0, intent.getLongExtra("positionMs", 0)));
                break;
            case ACTION_PREVIOUS:
                if (player.getCurrentPosition() > 5000 || !player.hasPreviousMediaItem()) player.seekTo(0);
                else player.seekToPreviousMediaItem();
                break;
            case ACTION_NEXT:
                if (player.hasNextMediaItem()) player.seekToNextMediaItem();
                break;
            default:
                break;
        }
        publishState();
        return result;
    }

    private void applyPendingQueue() {
        PendingQueue queue;
        synchronized (PENDING_LOCK) {
            queue = pendingQueue;
            pendingQueue = null;
        }
        if (queue == null || queue.tracks.isEmpty()) return;
        List<MediaItem> items = new ArrayList<>();
        for (Track track : queue.tracks) {
            MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                .setTitle(track.title)
                .setArtist(track.artist)
                .setAlbumTitle(track.album)
                .setIsBrowsable(false)
                .setIsPlayable(true);
            if (!track.artwork.isEmpty()) metadata.setArtworkUri(Uri.parse(track.artwork));
            items.add(new MediaItem.Builder()
                .setMediaId(track.id)
                .setUri(track.url)
                .setMediaMetadata(metadata.build())
                .build());
        }
        int index = Math.max(0, Math.min(queue.index, items.size() - 1));
        player.setMediaItems(items, index, queue.positionMs);
        player.prepare();
        if (queue.autoplay) player.play();
        else player.pause();
    }

    private void publishState() {
        if (player == null) return;
        long duration = player.getDuration();
        if (duration == C.TIME_UNSET || duration < 0) duration = 0;
        MediaItem current = player.getCurrentMediaItem();
        latestSnapshot = new PlaybackSnapshot(
            player.getPlayWhenReady(),
            player.getCurrentMediaItemIndex(),
            Math.max(0, player.getCurrentPosition()),
            duration,
            current == null ? "" : current.mediaId
        );
        Intent event = new Intent(EVENT_STATE)
            .setPackage(getPackageName())
            .putExtra("playing", latestSnapshot.playing)
            .putExtra("index", latestSnapshot.index)
            .putExtra("positionMs", latestSnapshot.positionMs)
            .putExtra("durationMs", latestSnapshot.durationMs)
            .putExtra("mediaId", latestSnapshot.mediaId);
        sendBroadcast(event);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            NOTIFICATION_CHANNEL,
            "音乐播放",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("后台播放与媒体控制");
        channel.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private void showPlaybackNotification() {
        if (mediaSession == null) return;
        Notification notification = buildPlaybackNotification();
        startForeground(NOTIFICATION_ID, notification);
    }

    private Notification buildPlaybackNotification() {
        MediaItem current = player == null ? null : player.getCurrentMediaItem();
        MediaMetadata metadata = current == null ? MediaMetadata.EMPTY : current.mediaMetadata;
        CharSequence title = metadata.title == null || metadata.title.length() == 0 ? "BMovie 音乐" : metadata.title;
        CharSequence artist = metadata.artist == null ? "准备播放" : metadata.artist;
        boolean playing = player != null && player.isPlaying();

        Intent launchIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 42, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        PendingIntent previousIntent = servicePendingIntent(ACTION_PREVIOUS, 43);
        PendingIntent playPauseIntent = servicePendingIntent(playing ? ACTION_PAUSE : ACTION_PLAY, 44);
        PendingIntent nextIntent = servicePendingIntent(ACTION_NEXT, 45);

        return new NotificationCompat.Builder(this, NOTIFICATION_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText(artist)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .setSilent(true)
            .addAction(android.R.drawable.ic_media_previous, "上一首", previousIntent)
            .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "暂停" : "播放", playPauseIntent)
            .addAction(android.R.drawable.ic_media_next, "下一首", nextIntent)
            .setStyle(new MediaStyleNotificationHelper.MediaStyle(mediaSession).setShowActionsInCompactView(0, 1, 2))
            .build();
    }

    private PendingIntent servicePendingIntent(String action, int requestCode) {
        Intent intent = new Intent(this, MusicPlaybackService.class).setAction(action);
        return PendingIntent.getService(
            this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    @Override public void onTaskRemoved(Intent rootIntent) {
        if (!player.isPlaying()) stopSelf();
    }

    @Override public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (mediaSession != null) mediaSession.release();
        if (player != null) player.release();
        mediaSession = null;
        player = null;
        super.onDestroy();
    }

    public static PlaybackSnapshot snapshot() {
        return latestSnapshot;
    }

    public static void setQueue(Context context, List<Track> tracks, int index, long positionMs, boolean autoplay) {
        synchronized (PENDING_LOCK) {
            pendingQueue = new PendingQueue(Collections.unmodifiableList(new ArrayList<>(tracks)), index, positionMs, autoplay);
        }
        dispatch(context, ACTION_SET_QUEUE, autoplay);
    }

    public static void play(Context context) { dispatch(context, ACTION_PLAY, true); }
    public static void pause(Context context) { dispatch(context, ACTION_PAUSE, false); }
    public static void previous(Context context) { dispatch(context, ACTION_PREVIOUS, true); }
    public static void next(Context context) { dispatch(context, ACTION_NEXT, true); }

    public static void seek(Context context, long positionMs) {
        Intent intent = new Intent(context, MusicPlaybackService.class)
            .setAction(ACTION_SEEK)
            .putExtra("positionMs", positionMs);
        context.startService(intent);
    }

    private static void dispatch(Context context, String action, boolean mayStartPlayback) {
        Intent intent = new Intent(context, MusicPlaybackService.class).setAction(action);
        if (mayStartPlayback) ContextCompat.startForegroundService(context, intent);
        else context.startService(intent);
    }
}
