package com.bmovie.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.net.Uri;
import android.view.View;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.Tracks;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;

import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.util.VLCVideoLayout;
import org.videolan.libvlc.interfaces.IMedia;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class PlayerActivity extends AppCompatActivity {
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_POSITION = "position";
    public static final String EXTRA_SUBTITLES = "subtitles";
    public static final String RESULT_POSITION = "position";
    public static final String RESULT_DURATION = "duration";

    private ExoPlayer player;
    private PlayerView playerView;
    private TextView errorView;
    private VLCVideoLayout vlcVideoLayout;
    private LinearLayout vlcControls;
    private SeekBar vlcSeek;
    private TextView vlcTime;
    private ImageButton vlcPlayPause;
    private TextView subtitleButton;
    private LibVLC libVLC;
    private org.videolan.libvlc.MediaPlayer vlcPlayer;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean usingVlc;
    private long resumePosition;
    private long duration;
    private boolean subtitlesEnabled = true;
    private int selectedVlcSubtitle = -1;
    private final List<SubtitleSource> subtitles = new ArrayList<>();

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN |
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
        setContentView(R.layout.activity_player);
        playerView = findViewById(R.id.native_player_view);
        errorView = findViewById(R.id.player_error);
        vlcVideoLayout = findViewById(R.id.vlc_video_layout);
        vlcControls = findViewById(R.id.vlc_controls);
        vlcSeek = findViewById(R.id.vlc_seek);
        vlcTime = findViewById(R.id.vlc_time);
        vlcPlayPause = findViewById(R.id.vlc_play_pause);
        subtitleButton = findViewById(R.id.player_subtitle);
        readSubtitles();
        subtitleButton.setVisibility(subtitles.isEmpty() ? View.GONE : View.VISIBLE);
        subtitleButton.setOnClickListener(view -> toggleSubtitles());
        updateSubtitleButton();
        TextView titleView = findViewById(R.id.player_title);
        titleView.setText(getIntent().getStringExtra(EXTRA_TITLE));
        ImageButton back = findViewById(R.id.player_back);
        back.setOnClickListener(view -> finish());
        resumePosition = getIntent().getLongExtra(EXTRA_POSITION, 0);
        vlcPlayPause.setOnClickListener(view -> {
            if (vlcPlayer == null) return;
            if (vlcPlayer.isPlaying()) vlcPlayer.pause(); else vlcPlayer.play();
            updateVlcPlayButton();
        });
        vlcSeek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                if (fromUser && vlcPlayer != null && duration > 0) vlcPlayer.setTime(duration * progress / 1000, true);
            }
            @Override public void onStartTrackingTouch(SeekBar seekBar) {}
            @Override public void onStopTrackingTouch(SeekBar seekBar) {}
        });
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (usingVlc) startVlcFallback(); else initializePlayer();
    }

    private void initializePlayer() {
        if (player != null) return;
        String url = getIntent().getStringExtra(EXTRA_URL);
        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
            .setUserAgent("BMovie/0.1 Android")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(20_000)
            .setReadTimeoutMs(30_000);
        DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(this, httpFactory);
        player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(dataSourceFactory))
            .build();
        player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
            .setPreferredTextLanguages("zh-CN", "zh", "zh-TW", "en")
            .setSelectUndeterminedTextLanguage(true)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            .build());
        playerView.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) {
                if (!usingVlc) startVlcFallback();
            }

            @Override
            public void onTracksChanged(Tracks tracks) {
                subtitleButton.setVisibility(hasMedia3SubtitleTrack(tracks) ? View.VISIBLE : View.GONE);
            }
        });
        MediaItem.Builder itemBuilder = new MediaItem.Builder().setUri(url);
        if (!subtitles.isEmpty()) {
            ArrayList<MediaItem.SubtitleConfiguration> configurations = new ArrayList<>();
            for (int index = 0; index < subtitles.size(); index++) {
                SubtitleSource source = subtitles.get(index);
                MediaItem.SubtitleConfiguration.Builder subtitleBuilder = new MediaItem.SubtitleConfiguration.Builder(Uri.parse(source.url))
                    .setMimeType(source.mimeType)
                    .setLabel(source.label)
                    .setSelectionFlags(index == 0 ? C.SELECTION_FLAG_DEFAULT : 0);
                if (!source.language.isEmpty()) subtitleBuilder.setLanguage(source.language);
                configurations.add(subtitleBuilder.build());
            }
            itemBuilder.setSubtitleConfigurations(configurations);
        }
        player.setMediaItem(itemBuilder.build());
        if (resumePosition > 0) player.seekTo(resumePosition);
        player.prepare();
        player.setPlayWhenReady(true);
    }

    @Override
    protected void onStop() {
        captureProgress();
        releasePlayer();
        releaseVlc();
        super.onStop();
    }

    private void captureProgress() {
        if (vlcPlayer != null) {
            resumePosition = Math.max(0, vlcPlayer.getTime());
            duration = Math.max(0, vlcPlayer.getLength());
            return;
        }
        if (player == null) return;
        resumePosition = Math.max(0, player.getCurrentPosition());
        duration = Math.max(0, player.getDuration());
    }

    private void releasePlayer() {
        handler.removeCallbacksAndMessages(null);
        if (player == null) return;
        playerView.setPlayer(null);
        player.release();
        player = null;
    }

    private void startVlcFallback() {
        usingVlc = true;
        captureProgress();
        if (player != null) {
            playerView.setPlayer(null);
            player.release();
            player = null;
        }
        playerView.setVisibility(View.GONE);
        vlcVideoLayout.setVisibility(View.VISIBLE);
        vlcControls.setVisibility(View.VISIBLE);
        errorView.setText(R.string.player_compatibility_mode);
        errorView.setVisibility(View.VISIBLE);

        ArrayList<String> options = new ArrayList<>();
        options.add("--avcodec-hw=none");
        options.add("--network-caching=1800");
        options.add("--clock-jitter=0");
        options.add("--clock-synchro=0");
        libVLC = new LibVLC(this, options);
        vlcPlayer = new org.videolan.libvlc.MediaPlayer(libVLC);
        vlcPlayer.attachViews(vlcVideoLayout, null, true, false);
        vlcPlayer.setEventListener(event -> {
            if (event.type == org.videolan.libvlc.MediaPlayer.Event.Playing) {
                if (resumePosition > 0) vlcPlayer.setTime(resumePosition, true);
                updateVlcPlayButton();
                handler.postDelayed(this::refreshVlcSubtitleTracks, 300);
            } else if (event.type == org.videolan.libvlc.MediaPlayer.Event.Vout && event.getVoutCount() > 0) {
                errorView.setVisibility(View.GONE);
            } else if (event.type == org.videolan.libvlc.MediaPlayer.Event.EncounteredError) {
                errorView.setText(R.string.player_software_decode_failed);
                errorView.setVisibility(View.VISIBLE);
            } else if (event.type == org.videolan.libvlc.MediaPlayer.Event.TimeChanged) {
                resumePosition = event.getTimeChanged();
            } else if (event.type == org.videolan.libvlc.MediaPlayer.Event.LengthChanged) {
                duration = event.getLengthChanged();
            }
        });
        Media media = new Media(libVLC, Uri.parse(getIntent().getStringExtra(EXTRA_URL)));
        media.setHWDecoderEnabled(false, false);
        media.addOption(":network-caching=1800");
        for (SubtitleSource source : subtitles) {
            media.addSlave(new IMedia.Slave(IMedia.Slave.Type.Subtitle, 4, source.url));
        }
        vlcPlayer.setMedia(media);
        media.release();
        vlcPlayer.play();
        handler.post(vlcProgressUpdater);
    }

    private final Runnable vlcProgressUpdater = new Runnable() {
        @Override public void run() {
            if (vlcPlayer == null) return;
            long current = Math.max(0, vlcPlayer.getTime());
            long length = Math.max(0, vlcPlayer.getLength());
            resumePosition = current;
            if (length > 0) duration = length;
            if (duration > 0) vlcSeek.setProgress((int) Math.min(1000, current * 1000 / duration));
            vlcTime.setText(formatTime(current) + " / " + formatTime(duration));
            updateVlcPlayButton();
            refreshVlcSubtitleTracks();
            handler.postDelayed(this, 500);
        }
    };

    private void updateVlcPlayButton() {
        if (vlcPlayer == null) return;
        vlcPlayPause.setImageResource(vlcPlayer.isPlaying() ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);
    }

    private boolean hasMedia3SubtitleTrack(Tracks tracks) {
        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() == C.TRACK_TYPE_TEXT) return true;
        }
        return false;
    }

    private void refreshVlcSubtitleTracks() {
        if (vlcPlayer == null) return;
        org.videolan.libvlc.MediaPlayer.TrackDescription[] tracks = vlcPlayer.getSpuTracks();
        int firstTrack = -1;
        if (tracks != null) {
            for (org.videolan.libvlc.MediaPlayer.TrackDescription track : tracks) {
                if (track.id >= 0) {
                    firstTrack = track.id;
                    break;
                }
            }
        }
        subtitleButton.setVisibility(firstTrack >= 0 ? View.VISIBLE : View.GONE);
        if (subtitlesEnabled && vlcPlayer.getSpuTrack() < 0 && firstTrack >= 0) {
            selectedVlcSubtitle = firstTrack;
            vlcPlayer.setSpuTrack(firstTrack);
        }
    }

    private void readSubtitles() {
        try {
            JSONArray array = new JSONArray(getIntent().getStringExtra(EXTRA_SUBTITLES));
            for (int index = 0; index < array.length(); index++) {
                JSONObject item = array.optJSONObject(index);
                if (item == null || item.optString("url").isEmpty()) continue;
                subtitles.add(new SubtitleSource(
                    item.optString("url"),
                    item.optString("label", getString(R.string.player_subtitles)),
                    item.optString("language"),
                    item.optString("mimeType", "application/x-subrip")
                ));
            }
        } catch (Exception ignored) {
        }
    }

    private void toggleSubtitles() {
        subtitlesEnabled = !subtitlesEnabled;
        if (usingVlc && vlcPlayer != null) {
            if (!subtitlesEnabled) {
                selectedVlcSubtitle = vlcPlayer.getSpuTrack();
                vlcPlayer.setSpuTrack(-1);
            } else {
                int target = selectedVlcSubtitle;
                if (target < 0 && vlcPlayer.getSpuTracks() != null) {
                    for (org.videolan.libvlc.MediaPlayer.TrackDescription track : vlcPlayer.getSpuTracks()) {
                        if (track.id >= 0) { target = track.id; break; }
                    }
                }
                if (target >= 0) vlcPlayer.setSpuTrack(target);
            }
        } else if (player != null) {
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !subtitlesEnabled)
                .build());
        }
        updateSubtitleButton();
    }

    private void updateSubtitleButton() {
        if (subtitleButton == null) return;
        subtitleButton.setText(subtitlesEnabled ? R.string.player_subtitles_on : R.string.player_subtitles_off);
        subtitleButton.setAlpha(subtitlesEnabled ? 1f : 0.62f);
    }

    private String formatTime(long millis) {
        long totalSeconds = Math.max(0, millis / 1000);
        return String.format(Locale.US, "%02d:%02d", totalSeconds / 60, totalSeconds % 60);
    }

    private void releaseVlc() {
        if (vlcPlayer != null) {
            vlcPlayer.stop();
            vlcPlayer.detachViews();
            vlcPlayer.release();
            vlcPlayer = null;
        }
        if (libVLC != null) {
            libVLC.release();
            libVLC = null;
        }
    }

    @Override
    public void finish() {
        captureProgress();
        Intent result = new Intent();
        result.putExtra(RESULT_POSITION, resumePosition);
        result.putExtra(RESULT_DURATION, duration);
        setResult(Activity.RESULT_OK, result);
        super.finish();
    }

    @Override
    protected void onDestroy() {
        releaseVlc();
        super.onDestroy();
    }

    private static final class SubtitleSource {
        final String url;
        final String label;
        final String language;
        final String mimeType;

        SubtitleSource(String url, String label, String language, String mimeType) {
            this.url = url;
            this.label = label;
            this.language = language == null ? "" : language;
            this.mimeType = mimeType;
        }
    }
}
