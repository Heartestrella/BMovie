package com.bmovie.app;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.Gravity;
import android.view.animation.LinearInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaLibraryInfo;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.DecoderCounters;
import androidx.media3.exoplayer.analytics.AnalyticsListener;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.CaptionStyleCompat;
import androidx.media3.ui.PlayerView;
import androidx.media3.ui.SubtitleView;

import org.json.JSONArray;
import org.json.JSONObject;
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.interfaces.IMedia;
import org.videolan.libvlc.util.VLCVideoLayout;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;

@UnstableApi
public class PlayerActivity extends AppCompatActivity {
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_POSITION = "position";
    public static final String EXTRA_SUBTITLES = "subtitles";
    public static final String EXTRA_DANMAKU = "danmaku";
    public static final String EXTRA_PAYLOAD_PATH = "payload_path";
    public static final String EXTRA_DANMAKU_SOURCE = "danmaku_source";
    public static final String RESULT_POSITION = "position";
    public static final String RESULT_DURATION = "duration";

    private static final String PREFERENCES = "bmovie_native_player";
    private static final String PREF_SUBTITLES_ENABLED = "subtitles_enabled";
    private static final String PREF_SUBTITLE_STYLE = "subtitle_style";
    private static final String PREF_SUBTITLE_SIZE = "subtitle_size";
    private static final String PREF_SUBTITLE_POSITION = "subtitle_position";
    private static final String PREF_SUBTITLE_SIZE_LEVEL = "subtitle_size_level_v2";
    private static final String PREF_SUBTITLE_POSITION_LEVEL = "subtitle_position_level_v2";
    private static final String PREF_SUBTITLE_COLOR = "subtitle_color_v2";
    private static final String PREF_SUBTITLE_OUTLINE = "subtitle_outline_v2";
    private static final String PREF_SUBTITLE_BACKGROUND = "subtitle_background_v2";
    private static final String PREF_QUALITY_HEIGHT = "quality_height";
    private static final String PREF_DEBUG_ENABLED = "debug_enabled";
    private static final String PREF_DANMAKU_ENABLED = "danmaku_enabled";
    private static final String PREF_DANMAKU_SCROLLING = "danmaku_scrolling_v2";
    private static final String PREF_DANMAKU_TOP = "danmaku_top_v2";
    private static final String PREF_DANMAKU_BOTTOM = "danmaku_bottom_v2";
    private static final String PREF_DANMAKU_COLOR = "danmaku_color_v2";
    private static final String PREF_DANMAKU_AREA = "danmaku_area_v2";
    private static final String PREF_DANMAKU_OPACITY = "danmaku_opacity_v2";
    private static final String PREF_DANMAKU_SIZE = "danmaku_size_v2";
    private static final String PREF_DANMAKU_SPEED = "danmaku_speed_v2";
    private static final String PREF_DANMAKU_PROTECT_SUBTITLES = "danmaku_protect_subtitles_v2";
    private static final String PREF_DANMAKU_SMART_COLLISION = "danmaku_smart_collision_v2";
    private static final String PREF_DANMAKU_SCALE_WITH_SCREEN = "danmaku_scale_with_screen_v2";
    private static final String STYLE_ORIGINAL = "original";
    private static final String STYLE_OUTLINE = "outline";
    private static final String STYLE_YELLOW = "yellow";
    private static final String STYLE_BOX = "box";
    private static final String STYLE_CUSTOM = "custom";
    private static final long CONTROLS_TIMEOUT_MS = 4_000;

    private ExoPlayer player;
    private PlayerView playerView;
    private VLCVideoLayout vlcVideoLayout;
    private LibVLC libVLC;
    private org.videolan.libvlc.MediaPlayer vlcPlayer;

    private View controlsOverlay;
    private View panelScrim;
    private LinearLayout settingsPanel;
    private LinearLayout subtitleSettingsContent;
    private LinearLayout qualitySettingsContent;
    private LinearLayout qualityOptions;
    private LinearLayout subtitleTrackOptions;
    private TextView panelTitle;
    private TextView errorView;
    private TextView subtitleButton;
    private TextView subtitleToggle;
    private TextView qualityButton;
    private TextView debugButton;
    private TextView debugText;
    private TextView qualityHint;
    private TextView modeBadge;
    private TextView timeView;
    private TextView subtitleCompatibilityNote;
    private TextView subtitleTrackStatus;
    private TextView subtitleSizeValue;
    private TextView subtitlePositionValue;
    private TextView subtitleOutlineValue;
    private TextView subtitleBackgroundValue;
    private TextView danmakuSettingsToggle;
    private TextView danmakuSettingsStatus;
    private TextView danmakuScrollingToggle;
    private TextView danmakuTopToggle;
    private TextView danmakuBottomToggle;
    private TextView danmakuColorToggle;
    private TextView danmakuProtectSubtitlesToggle;
    private TextView danmakuSmartCollisionToggle;
    private TextView danmakuScaleWithScreenToggle;
    private TextView danmakuAreaValue;
    private TextView danmakuOpacityValue;
    private TextView danmakuSizeValue;
    private TextView danmakuSpeedValue;
    private TextView danmakuButton;
    private TextView danmakuSourceView;
    private FrameLayout danmakuOverlay;
    private ImageButton playPauseButton;
    private SeekBar seekBar;
    private SeekBar subtitleSizeSeek;
    private SeekBar subtitlePositionSeek;
    private SeekBar subtitleOutlineSeek;
    private SeekBar subtitleBackgroundSeek;
    private SeekBar danmakuAreaSeek;
    private SeekBar danmakuOpacitySeek;
    private SeekBar danmakuSizeSeek;
    private SeekBar danmakuSpeedSeek;
    private View debugPanel;
    private View gestureSurface;
    private TextView gestureValue;
    private AudioManager audioManager;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<SubtitleSource> subtitles = new ArrayList<>();
    private final List<DanmakuEntry> danmakuEntries = new ArrayList<>();
    private final List<ActiveDanmaku> activeDanmaku = new ArrayList<>();
    private final Set<Integer> availableVideoHeights = new TreeSet<>(Collections.reverseOrder());
    private SharedPreferences preferences;
    private boolean usingVlc;
    private boolean controlsVisible = true;
    private boolean seeking;
    private boolean subtitlesEnabled = true;
    private boolean debugEnabled;
    private boolean danmakuEnabled = true;
    private boolean danmakuScrolling = true;
    private boolean danmakuTop = true;
    private boolean danmakuBottom = true;
    private boolean danmakuColor = true;
    private boolean danmakuProtectSubtitles = true;
    private boolean danmakuSmartCollision = true;
    private boolean danmakuScaleWithScreen = true;
    private boolean danmakuPlaybackPaused = true;
    private int danmakuArea = 6;
    private int danmakuOpacity = 9;
    private int danmakuSize = 5;
    private int danmakuSpeed = 2;
    private int danmakuCursor;
    private int danmakuLane;
    private long lastDanmakuPosition = -1;
    private boolean hasMedia3Subtitles;
    private int selectedVlcSubtitle = -1;
    private int subtitleSize = 4;
    private int subtitlePosition = 3;
    private int subtitleColor;
    private int subtitleOutline = 3;
    private int subtitleBackground;
    private int vlcSubtitleRefreshAttempts;
    private int qualityHeight;
    private int appliedQualityHeight = Integer.MIN_VALUE;
    private String subtitleStyle = STYLE_ORIGINAL;
    private long resumePosition;
    private long duration;
    private long pendingVlcResumePosition;
    private String videoDecoderName = "等待初始化";
    private String audioDecoderName = "等待初始化";
    private String lastPlaybackError = "";
    private Format media3VideoFormat;
    private Format media3AudioFormat;
    private DecoderCounters media3VideoCounters;
    private long streamBitsPerSecond;
    private long lastDebugUiUpdateMs;
    private long lastFrameSampleMs;
    private int lastRenderedFrames;
    private int lastVlcDisplayedPictures;
    private long lastVlcReadBytes;
    private long lastVlcStatsSampleMs;
    private double playbackFps;
    private boolean hasPlaybackFpsSample;
    private String danmakuSource = "";
    private JSONObject playbackPayload;
    private float gestureStartX;
    private float gestureStartY;
    private float gestureStartBrightness;
    private int gestureStartVolume;
    private int gestureMode;
    private boolean gestureChanged;

    private final Runnable hideControlsRunnable = this::hideControls;
    private final Runnable hideGestureValueRunnable = () -> gestureValue.setVisibility(View.GONE);
    private final Runnable restartVlcRunnable = () -> {
        if (!usingVlc || isFinishing()) return;
        captureProgress();
        releaseVlc();
        startVlcFallback();
    };
    private final Runnable progressUpdater = new Runnable() {
        @Override public void run() {
            updateProgress();
            updateDebugInfo();
            handler.postDelayed(this, 500);
        }
    };

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
        preferences = getSharedPreferences(PREFERENCES, MODE_PRIVATE);
        loadPreferences();
        bindViews();
        playbackPayload = PlayerPayloadStore.read(getIntent().getStringExtra(EXTRA_PAYLOAD_PATH));
        readSubtitles();
        readDanmaku();
        danmakuSource = getIntent().getStringExtra(EXTRA_DANMAKU_SOURCE);
        if (danmakuSource == null) danmakuSource = "";
        bindPlayerControls();
        bindSettingsControls();
        resumePosition = getIntent().getLongExtra(EXTRA_POSITION, 0);
        ((TextView) findViewById(R.id.player_title)).setText(getIntent().getStringExtra(EXTRA_TITLE));
        updateSettingsUi();
        updateSubtitleButton();
        updateDebugVisibility();
        updateDanmakuButton();
        bindPlaybackGestures();
        showControls(true);
    }

    private void bindViews() {
        playerView = findViewById(R.id.native_player_view);
        vlcVideoLayout = findViewById(R.id.vlc_video_layout);
        controlsOverlay = findViewById(R.id.player_controls);
        panelScrim = findViewById(R.id.player_panel_scrim);
        settingsPanel = findViewById(R.id.player_settings_panel);
        subtitleSettingsContent = findViewById(R.id.player_subtitle_settings_content);
        qualitySettingsContent = findViewById(R.id.player_quality_settings_content);
        qualityOptions = findViewById(R.id.player_quality_options);
        subtitleTrackOptions = findViewById(R.id.player_subtitle_track_options);
        panelTitle = findViewById(R.id.player_panel_title);
        errorView = findViewById(R.id.player_error);
        subtitleButton = findViewById(R.id.player_subtitle);
        subtitleToggle = findViewById(R.id.player_subtitle_toggle);
        qualityButton = findViewById(R.id.player_quality);
        debugButton = findViewById(R.id.player_debug_toggle);
        debugPanel = findViewById(R.id.player_debug_panel);
        gestureSurface = findViewById(R.id.player_gesture_surface);
        gestureValue = findViewById(R.id.player_gesture_value);
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        debugText = findViewById(R.id.player_debug_text);
        qualityHint = findViewById(R.id.player_quality_hint);
        modeBadge = findViewById(R.id.player_mode_badge);
        timeView = findViewById(R.id.player_time);
        subtitleCompatibilityNote = findViewById(R.id.player_subtitle_compatibility_note);
        subtitleTrackStatus = findViewById(R.id.player_subtitle_track_status);
        subtitleSizeValue = findViewById(R.id.player_subtitle_size_value);
        subtitlePositionValue = findViewById(R.id.player_subtitle_position_value);
        subtitleOutlineValue = findViewById(R.id.player_subtitle_outline_value);
        subtitleBackgroundValue = findViewById(R.id.player_subtitle_background_value);
        danmakuSettingsToggle = findViewById(R.id.player_danmaku_settings_toggle);
        danmakuSettingsStatus = findViewById(R.id.player_danmaku_settings_status);
        danmakuScrollingToggle = findViewById(R.id.player_danmaku_scrolling_toggle);
        danmakuTopToggle = findViewById(R.id.player_danmaku_top_toggle);
        danmakuBottomToggle = findViewById(R.id.player_danmaku_bottom_toggle);
        danmakuColorToggle = findViewById(R.id.player_danmaku_color_toggle);
        danmakuProtectSubtitlesToggle = findViewById(R.id.player_danmaku_protect_subtitles_toggle);
        danmakuSmartCollisionToggle = findViewById(R.id.player_danmaku_smart_collision_toggle);
        danmakuScaleWithScreenToggle = findViewById(R.id.player_danmaku_scale_with_screen_toggle);
        danmakuAreaValue = findViewById(R.id.player_danmaku_area_value);
        danmakuOpacityValue = findViewById(R.id.player_danmaku_opacity_value);
        danmakuSizeValue = findViewById(R.id.player_danmaku_size_value);
        danmakuSpeedValue = findViewById(R.id.player_danmaku_speed_value);
        danmakuButton = findViewById(R.id.player_danmaku);
        danmakuSourceView = findViewById(R.id.player_danmaku_source);
        danmakuOverlay = findViewById(R.id.player_danmaku_overlay);
        playPauseButton = findViewById(R.id.player_play_pause);
        seekBar = findViewById(R.id.player_seek);
        subtitleSizeSeek = findViewById(R.id.player_subtitle_size_seek);
        subtitlePositionSeek = findViewById(R.id.player_subtitle_position_seek);
        subtitleOutlineSeek = findViewById(R.id.player_subtitle_outline_seek);
        subtitleBackgroundSeek = findViewById(R.id.player_subtitle_background_seek);
        danmakuAreaSeek = findViewById(R.id.player_danmaku_area_seek);
        danmakuOpacitySeek = findViewById(R.id.player_danmaku_opacity_seek);
        danmakuSizeSeek = findViewById(R.id.player_danmaku_size_seek);
        danmakuSpeedSeek = findViewById(R.id.player_danmaku_speed_seek);
    }

    private void bindPlayerControls() {
        findViewById(R.id.player_back).setOnClickListener(view -> finish());
        playPauseButton.setOnClickListener(view -> togglePlayback());
        subtitleButton.setOnClickListener(view -> showSettingsPanel(true));
        qualityButton.setOnClickListener(view -> showSettingsPanel(false));
        debugButton.setOnClickListener(view -> setDebugEnabled(!debugEnabled));
        danmakuButton.setOnClickListener(view -> setDanmakuEnabled(!danmakuEnabled));
        danmakuSettingsToggle.setOnClickListener(view -> {
            if (!danmakuEntries.isEmpty()) setDanmakuEnabled(!danmakuEnabled);
        });
        findViewById(R.id.player_panel_close).setOnClickListener(view -> closeSettingsPanel());
        panelScrim.setOnClickListener(view -> closeSettingsPanel());

        seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (!fromUser) return;
                long length = currentDuration();
                if (length > 0) timeView.setText(formatTime(length * progress / 1000) + " / " + formatTime(length));
            }

            @Override public void onStartTrackingTouch(SeekBar bar) {
                seeking = true;
                setDanmakuAnimationsPaused(true);
                showControls(false);
            }

            @Override public void onStopTrackingTouch(SeekBar bar) {
                long length = currentDuration();
                long target = length > 0 ? length * bar.getProgress() / 1000 : 0;
                if (vlcPlayer != null) vlcPlayer.setTime(target, true);
                else if (player != null) player.seekTo(target);
                resetDanmaku(target);
                seeking = false;
                syncDanmakuPlaybackState();
                scheduleControlsHide();
            }
        });
    }

    private void bindPlaybackGestures() {
        gestureSurface.setOnClickListener(view -> toggleControls());
        gestureSurface.setOnTouchListener((view, event) -> {
            if (settingsPanel.getVisibility() == View.VISIBLE) return false;
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    gestureStartX = event.getX();
                    gestureStartY = event.getY();
                    gestureStartBrightness = currentBrightness();
                    gestureStartVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
                    gestureMode = 0;
                    gestureChanged = false;
                    handler.removeCallbacks(hideGestureValueRunnable);
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float deltaX = event.getX() - gestureStartX;
                    float deltaY = event.getY() - gestureStartY;
                    if (gestureMode == 0) {
                        float threshold = dp(12);
                        if (Math.abs(deltaY) < threshold || Math.abs(deltaY) < Math.abs(deltaX) * 1.15f) return true;
                        gestureMode = gestureStartX < view.getWidth() / 2f ? 1 : 2;
                    }
                    float change = -deltaY / Math.max(1f, view.getHeight()) * 1.35f;
                    if (gestureMode == 1) updateGestureBrightness(gestureStartBrightness + change);
                    else updateGestureVolume(gestureStartVolume, change);
                    gestureChanged = true;
                    return true;
                case MotionEvent.ACTION_UP:
                    if (!gestureChanged) view.performClick();
                    else handler.postDelayed(hideGestureValueRunnable, 700);
                    gestureMode = 0;
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    handler.postDelayed(hideGestureValueRunnable, 300);
                    gestureMode = 0;
                    return true;
                default:
                    return true;
            }
        });
    }

    private float currentBrightness() {
        float windowBrightness = getWindow().getAttributes().screenBrightness;
        if (windowBrightness >= 0f) return windowBrightness;
        try {
            return Math.max(0.01f, Settings.System.getInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS) / 255f);
        } catch (Settings.SettingNotFoundException ignored) {
            return 0.5f;
        }
    }

    private void updateGestureBrightness(float value) {
        float brightness = Math.max(0.01f, Math.min(1f, value));
        WindowManager.LayoutParams attributes = getWindow().getAttributes();
        attributes.screenBrightness = brightness;
        getWindow().setAttributes(attributes);
        showGestureValue("亮度", Math.round(brightness * 100f));
    }

    private void updateGestureVolume(int startVolume, float change) {
        int maximum = Math.max(1, audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        int volume = Math.max(0, Math.min(maximum, Math.round(startVolume + change * maximum)));
        audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, volume, 0);
        showGestureValue("音量", Math.round(volume * 100f / maximum));
    }

    private void showGestureValue(String label, int percent) {
        gestureValue.setText(label + "  " + percent + "%");
        gestureValue.setVisibility(View.VISIBLE);
        gestureValue.bringToFront();
    }

    private void bindSettingsControls() {
        subtitleToggle.setOnClickListener(view -> setSubtitlesEnabled(!subtitlesEnabled));
        bindDanmakuSettingsControls();
        bindStyleOption(R.id.subtitle_style_original, STYLE_ORIGINAL);
        bindStyleOption(R.id.subtitle_style_outline, STYLE_OUTLINE);
        bindStyleOption(R.id.subtitle_style_yellow, STYLE_YELLOW);
        bindStyleOption(R.id.subtitle_style_box, STYLE_BOX);
        bindColorOption(R.id.subtitle_color_white, 0);
        bindColorOption(R.id.subtitle_color_yellow, 1);
        bindColorOption(R.id.subtitle_color_cyan, 2);
        bindSubtitleSeekBars();
    }

    private void bindDanmakuSettingsControls() {
        bindDanmakuToggle(danmakuScrollingToggle, () -> danmakuScrolling = !danmakuScrolling);
        bindDanmakuToggle(danmakuTopToggle, () -> danmakuTop = !danmakuTop);
        bindDanmakuToggle(danmakuBottomToggle, () -> danmakuBottom = !danmakuBottom);
        bindDanmakuToggle(danmakuColorToggle, () -> danmakuColor = !danmakuColor);
        bindDanmakuToggle(danmakuProtectSubtitlesToggle, () -> danmakuProtectSubtitles = !danmakuProtectSubtitles);
        bindDanmakuToggle(danmakuSmartCollisionToggle, () -> danmakuSmartCollision = !danmakuSmartCollision);
        bindDanmakuToggle(danmakuScaleWithScreenToggle, () -> danmakuScaleWithScreen = !danmakuScaleWithScreen);
        bindDanmakuSeekBar(danmakuAreaSeek, value -> danmakuArea = value);
        bindDanmakuSeekBar(danmakuOpacitySeek, value -> danmakuOpacity = value);
        bindDanmakuSeekBar(danmakuSizeSeek, value -> danmakuSize = value);
        bindDanmakuSeekBar(danmakuSpeedSeek, value -> danmakuSpeed = value);
    }

    private void bindDanmakuToggle(TextView view, Runnable action) {
        view.setOnClickListener(clicked -> {
            action.run();
            savePreferences();
            resetDanmaku(currentPosition());
            updateDanmakuSettingsUi();
        });
    }

    private void bindDanmakuSeekBar(SeekBar seekBar, IntValueConsumer consumer) {
        seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (!fromUser) return;
                consumer.accept(progress);
                updateDanmakuSettingsUi();
            }

            @Override public void onStartTrackingTouch(SeekBar bar) {
                setDanmakuAnimationsPaused(true);
            }

            @Override public void onStopTrackingTouch(SeekBar bar) {
                savePreferences();
                resetDanmaku(currentPosition());
                syncDanmakuPlaybackState();
            }
        });
    }

    private void bindStyleOption(int viewId, String style) {
        findViewById(viewId).setOnClickListener(view -> {
            subtitleStyle = style;
            if (STYLE_OUTLINE.equals(style)) {
                subtitleColor = 0;
                subtitleOutline = 3;
                subtitleBackground = 0;
            } else if (STYLE_YELLOW.equals(style)) {
                subtitleColor = 1;
                subtitleOutline = 3;
                subtitleBackground = 0;
            } else if (STYLE_BOX.equals(style)) {
                subtitleColor = 0;
                subtitleOutline = 0;
                subtitleBackground = 8;
            }
            savePreferences();
            applySubtitleVisualSettings(true);
            updateSettingsUi();
        });
    }

    private void bindColorOption(int viewId, int color) {
        findViewById(viewId).setOnClickListener(view -> {
            subtitleColor = color;
            subtitleStyle = STYLE_CUSTOM;
            savePreferences();
            applySubtitleVisualSettings(true);
            updateSettingsUi();
        });
    }

    private void bindSubtitleSeekBars() {
        bindSubtitleSeekBar(subtitleSizeSeek, value -> subtitleSize = value);
        bindSubtitleSeekBar(subtitlePositionSeek, value -> subtitlePosition = value);
        bindSubtitleSeekBar(subtitleOutlineSeek, value -> {
            subtitleOutline = value;
            subtitleStyle = STYLE_CUSTOM;
        });
        bindSubtitleSeekBar(subtitleBackgroundSeek, value -> {
            subtitleBackground = value;
            subtitleStyle = STYLE_CUSTOM;
        });
    }

    private void bindSubtitleSeekBar(SeekBar seekBar, IntValueConsumer consumer) {
        seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (!fromUser) return;
                consumer.accept(progress);
                updateSettingsUi();
            }

            @Override public void onStartTrackingTouch(SeekBar bar) {
            }

            @Override public void onStopTrackingTouch(SeekBar bar) {
                savePreferences();
                applySubtitleVisualSettings(true);
            }
        });
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (usingVlc) startVlcFallback(); else initializePlayer();
        handler.removeCallbacks(progressUpdater);
        handler.post(progressUpdater);
    }

    private void initializePlayer() {
        if (player != null) return;
        playerView.setVisibility(View.VISIBLE);
        vlcVideoLayout.setVisibility(View.GONE);
        modeBadge.setVisibility(View.GONE);
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
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !subtitlesEnabled)
            .build());
        playerView.setPlayer(player);
        applySubtitleVisualSettings(false);
        appliedQualityHeight = Integer.MIN_VALUE;
        resetMedia3DebugMetrics();
        player.addListener(new Player.Listener() {
            @Override public void onPlayerError(PlaybackException error) {
                lastPlaybackError = error.getErrorCodeName();
                if (!usingVlc) startVlcFallback();
            }

            @Override public void onTracksChanged(Tracks tracks) {
                updateTrackCapabilities(tracks);
            }

            @Override public void onIsPlayingChanged(boolean isPlaying) {
                updatePlayPauseButton();
                setDanmakuAnimationsPaused(!isPlaying);
                if (isPlaying) scheduleControlsHide(); else showControls(false);
            }

            @Override public void onPlaybackStateChanged(int playbackState) {
                updatePlayPauseButton();
            }
        });
        player.addAnalyticsListener(new AnalyticsListener() {
            @Override public void onVideoEnabled(EventTime eventTime, DecoderCounters counters) {
                media3VideoCounters = counters;
                lastRenderedFrames = counters.renderedOutputBufferCount;
                lastFrameSampleMs = SystemClock.elapsedRealtime();
            }

            @Override public void onVideoDecoderInitialized(EventTime eventTime, String decoderName, long initializedTimestampMs, long initializationDurationMs) {
                videoDecoderName = decoderName;
            }

            @Override public void onAudioDecoderInitialized(EventTime eventTime, String decoderName, long initializedTimestampMs, long initializationDurationMs) {
                audioDecoderName = decoderName;
            }

            @Override public void onVideoInputFormatChanged(EventTime eventTime, Format format, androidx.media3.exoplayer.DecoderReuseEvaluation decoderReuseEvaluation) {
                media3VideoFormat = format;
            }

            @Override public void onAudioInputFormatChanged(EventTime eventTime, Format format, androidx.media3.exoplayer.DecoderReuseEvaluation decoderReuseEvaluation) {
                media3AudioFormat = format;
            }

            @Override public void onBandwidthEstimate(EventTime eventTime, int totalLoadTimeMs, long totalBytesLoaded, long bitrateEstimate) {
                if (totalLoadTimeMs > 0 && totalBytesLoaded > 0) streamBitsPerSecond = totalBytesLoaded * 8_000L / totalLoadTimeMs;
                else streamBitsPerSecond = Math.max(0, bitrateEstimate);
            }

            @Override public void onDroppedVideoFrames(EventTime eventTime, int droppedFrames, long elapsedMs) {
                if (media3VideoCounters == null) return;
                media3VideoCounters.ensureUpdated();
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

    private void updateTrackCapabilities(Tracks tracks) {
        availableVideoHeights.clear();
        hasMedia3Subtitles = false;
        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() == C.TRACK_TYPE_TEXT) hasMedia3Subtitles = true;
            if (group.getType() != C.TRACK_TYPE_VIDEO) continue;
            for (int index = 0; index < group.length; index++) {
                if (!group.isTrackSupported(index)) continue;
                Format format = group.getTrackFormat(index);
                if (format.height > 0) availableVideoHeights.add(format.height);
            }
        }
        updateSubtitleButton();
        updateQualityButton();
        if (availableVideoHeights.size() > 1 && appliedQualityHeight != qualityHeight) applyQualityPreference();
    }

    private void startVlcFallback() {
        if (vlcPlayer != null) return;
        usingVlc = true;
        lastVlcDisplayedPictures = 0;
        lastVlcReadBytes = 0;
        lastVlcStatsSampleMs = 0;
        playbackFps = 0;
        hasPlaybackFpsSample = false;
        streamBitsPerSecond = 0;
        vlcSubtitleRefreshAttempts = 0;
        captureProgress();
        releasePlayer();
        playerView.setVisibility(View.GONE);
        vlcVideoLayout.setVisibility(View.VISIBLE);
        modeBadge.setVisibility(View.VISIBLE);
        errorView.setText(R.string.player_compatibility_mode);
        errorView.setVisibility(View.VISIBLE);

        ArrayList<String> options = new ArrayList<>();
        options.add("--avcodec-hw=none");
        options.add("--network-caching=1800");
        options.add("--clock-jitter=0");
        options.add("--clock-synchro=0");
        addVlcSubtitleOptions(options);
        libVLC = new LibVLC(this, options);
        vlcPlayer = new org.videolan.libvlc.MediaPlayer(libVLC);
        vlcPlayer.attachViews(vlcVideoLayout, null, true, false);
        pendingVlcResumePosition = resumePosition;
        vlcPlayer.setEventListener(event -> {
            if (event.type == org.videolan.libvlc.MediaPlayer.Event.Playing) {
                if (pendingVlcResumePosition > 0) {
                    vlcPlayer.setTime(pendingVlcResumePosition, true);
                    pendingVlcResumePosition = 0;
                }
                updatePlayPauseButton();
                setDanmakuAnimationsPaused(false);
                handler.postDelayed(this::refreshVlcSubtitleTracks, 200);
            } else if (event.type == org.videolan.libvlc.MediaPlayer.Event.Paused
                || event.type == org.videolan.libvlc.MediaPlayer.Event.Stopped
                || event.type == org.videolan.libvlc.MediaPlayer.Event.EndReached) {
                setDanmakuAnimationsPaused(true);
                updatePlayPauseButton();
            } else if (event.type == org.videolan.libvlc.MediaPlayer.Event.Vout && event.getVoutCount() > 0) {
                errorView.setVisibility(View.GONE);
                scheduleControlsHide();
            } else if (event.type == org.videolan.libvlc.MediaPlayer.Event.EncounteredError) {
                lastPlaybackError = getString(R.string.player_software_decode_failed);
                errorView.setText(R.string.player_software_decode_failed);
                errorView.setVisibility(View.VISIBLE);
                showControls(false);
            } else if (event.type == org.videolan.libvlc.MediaPlayer.Event.TimeChanged) {
                resumePosition = event.getTimeChanged();
            } else if (event.type == org.videolan.libvlc.MediaPlayer.Event.LengthChanged) {
                duration = event.getLengthChanged();
            }
        });
        Media media = new Media(libVLC, Uri.parse(getIntent().getStringExtra(EXTRA_URL)));
        media.setHWDecoderEnabled(false, false);
        media.addOption(":network-caching=1800");
        for (SubtitleSource source : subtitles) media.addSlave(new IMedia.Slave(IMedia.Slave.Type.Subtitle, 4, source.url));
        vlcPlayer.setMedia(media);
        media.release();
        vlcPlayer.play();
        updateQualityButton();
        updateSettingsUi();
    }

    private void addVlcSubtitleOptions(List<String> options) {
        int relativeSize = Math.max(10, 22 - Math.max(0, Math.min(8, subtitleSize)) * 2);
        int foreground = subtitleForegroundColor();
        options.add("--freetype-rel-fontsize=" + relativeSize);
        options.add("--freetype-color=" + (foreground & 0xFFFFFF));
        options.add("--freetype-opacity=255");
        options.add("--freetype-outline-color=0");
        options.add("--freetype-outline-opacity=255");
        options.add("--freetype-outline-thickness=" + Math.max(0, Math.min(6, subtitleOutline)));
        options.add("--freetype-background-opacity=" + Math.max(0, Math.min(10, subtitleBackground)) * 22);
        options.add("--sub-margin=" + (18 + Math.max(0, Math.min(8, subtitlePosition)) * 18));
    }

    private void applySubtitleVisualSettings(boolean restartVlc) {
        SubtitleView subtitleView = playerView.getSubtitleView();
        if (subtitleView != null) {
            boolean original = STYLE_ORIGINAL.equals(subtitleStyle);
            subtitleView.setApplyEmbeddedStyles(original);
            subtitleView.setApplyEmbeddedFontSizes(original && subtitleSize == 4);
            subtitleView.setFixedTextSize(TypedValue.COMPLEX_UNIT_SP, subtitleFontSp());
            subtitleView.setBottomPaddingFraction(0.025f + Math.max(0, Math.min(8, subtitlePosition)) * 0.022f);
            if (!original) {
                int foreground = subtitleForegroundColor();
                int background = subtitleBackground > 0 ? Color.argb(subtitleBackground * 22, 0, 0, 0) : Color.TRANSPARENT;
                int edgeType = subtitleOutline > 0 ? CaptionStyleCompat.EDGE_TYPE_OUTLINE : CaptionStyleCompat.EDGE_TYPE_NONE;
                subtitleView.setStyle(new CaptionStyleCompat(foreground, background, Color.TRANSPARENT, edgeType, Color.BLACK, null));
            }
        }
        if (restartVlc && usingVlc) {
            handler.removeCallbacks(restartVlcRunnable);
            handler.postDelayed(restartVlcRunnable, 180);
        }
    }

    private int subtitleForegroundColor() {
        if (subtitleColor == 1 || STYLE_YELLOW.equals(subtitleStyle)) return Color.rgb(255, 224, 102);
        if (subtitleColor == 2) return Color.rgb(122, 232, 255);
        return Color.WHITE;
    }

    private int subtitleFontSp() {
        return 18 + Math.max(0, Math.min(8, subtitleSize)) * 3;
    }

    private void setSubtitlesEnabled(boolean enabled) {
        subtitlesEnabled = enabled;
        savePreferences();
        if (usingVlc && vlcPlayer != null) {
            if (!enabled) {
                selectedVlcSubtitle = vlcPlayer.getSpuTrack();
                vlcPlayer.setSpuTrack(-1);
            } else {
                int target = selectedVlcSubtitle >= 0 ? selectedVlcSubtitle : firstVlcSubtitleTrack();
                if (target >= 0) vlcPlayer.setSpuTrack(target);
            }
        } else if (player != null) {
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !enabled)
                .build());
        }
        updateSubtitleButton();
        updateSettingsUi();
        populateSubtitleTracks();
    }

    private void refreshVlcSubtitleTracks() {
        if (vlcPlayer == null) return;
        int firstTrack = firstVlcSubtitleTrack();
        if (subtitlesEnabled && vlcPlayer.getSpuTrack() < 0 && firstTrack >= 0) {
            selectedVlcSubtitle = firstTrack;
            vlcPlayer.setSpuTrack(firstTrack);
        }
        populateSubtitleTracks();
        updateSubtitleButton();
        if (firstTrack < 0 && vlcSubtitleRefreshAttempts++ < 10) {
            handler.postDelayed(this::refreshVlcSubtitleTracks, 500);
        }
    }

    private int firstVlcSubtitleTrack() {
        if (vlcPlayer == null || vlcPlayer.getSpuTracks() == null) return -1;
        int fallback = -1;
        for (org.videolan.libvlc.MediaPlayer.TrackDescription track : vlcPlayer.getSpuTracks()) {
            if (track.id < 0) continue;
            if (fallback < 0) fallback = track.id;
            String name = track.name == null ? "" : track.name.toLowerCase(Locale.ROOT);
            if (name.contains("中文") || name.contains("简体") || name.contains("繁体")
                || name.contains("chi") || name.contains("zho") || name.contains("chs") || name.contains("cht")) return track.id;
        }
        return fallback;
    }

    private void populateSubtitleTracks() {
        if (subtitleTrackOptions == null || subtitleTrackStatus == null) return;
        subtitleTrackOptions.removeAllViews();
        if (!usingVlc) {
            boolean available = hasMedia3Subtitles || !subtitles.isEmpty();
            subtitleTrackStatus.setText(available
                ? getString(R.string.player_subtitle_track_auto)
                : getString(R.string.player_subtitle_track_waiting));
            return;
        }
        org.videolan.libvlc.MediaPlayer.TrackDescription[] tracks = vlcPlayer == null ? null : vlcPlayer.getSpuTracks();
        int count = 0;
        if (tracks != null) {
            for (org.videolan.libvlc.MediaPlayer.TrackDescription track : tracks) {
                if (track.id < 0) continue;
                count += 1;
                addSubtitleTrackOption(track.name == null || track.name.trim().isEmpty()
                    ? getString(R.string.player_subtitle_track_number, count)
                    : track.name, track.id, vlcPlayer.getSpuTrack() == track.id);
            }
        }
        subtitleTrackStatus.setText(count > 0
            ? getString(R.string.player_subtitle_track_count, count)
            : getString(R.string.player_subtitle_track_loading));
    }

    private void addSubtitleTrackOption(String label, int trackId, boolean selected) {
        TextView option = new TextView(this);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42));
        params.bottomMargin = dp(8);
        option.setLayoutParams(params);
        option.setBackgroundResource(R.drawable.player_setting_option);
        option.setGravity(Gravity.CENTER_VERTICAL);
        option.setPadding(dp(14), 0, dp(14), 0);
        option.setText(label);
        option.setTextSize(12);
        option.setTypeface(option.getTypeface(), Typeface.BOLD);
        option.setSelected(selected);
        option.setTextColor(selected ? Color.rgb(11, 11, 16) : Color.rgb(247, 245, 240));
        option.setOnClickListener(view -> {
            if (vlcPlayer == null) return;
            selectedVlcSubtitle = trackId;
            subtitlesEnabled = true;
            vlcPlayer.setSpuTrack(trackId);
            savePreferences();
            updateSubtitleButton();
            updateSettingsUi();
            populateSubtitleTracks();
        });
        subtitleTrackOptions.addView(option);
    }

    private void showSettingsPanel(boolean subtitleSettings) {
        panelTitle.setText(subtitleSettings ? R.string.player_display_settings : R.string.player_quality_settings);
        subtitleSettingsContent.setVisibility(subtitleSettings ? View.VISIBLE : View.GONE);
        qualitySettingsContent.setVisibility(subtitleSettings ? View.GONE : View.VISIBLE);
        if (subtitleSettings) populateSubtitleTracks(); else populateQualityOptions();
        subtitleCompatibilityNote.setVisibility(usingVlc ? View.VISIBLE : View.GONE);
        showControls(false);
        panelScrim.setVisibility(View.VISIBLE);
        settingsPanel.setVisibility(View.VISIBLE);
        if (animationsEnabled()) {
            panelScrim.setAlpha(0f);
            panelScrim.animate().alpha(1f).setDuration(180).start();
            settingsPanel.post(() -> {
                settingsPanel.setTranslationX(settingsPanel.getWidth());
                settingsPanel.animate().translationX(0f).setDuration(200).start();
            });
        } else {
            panelScrim.setAlpha(1f);
            settingsPanel.setTranslationX(0f);
        }
    }

    private void closeSettingsPanel() {
        if (settingsPanel.getVisibility() != View.VISIBLE) return;
        if (animationsEnabled()) {
            panelScrim.animate().alpha(0f).setDuration(150).withEndAction(() -> panelScrim.setVisibility(View.GONE)).start();
            settingsPanel.animate().translationX(settingsPanel.getWidth()).setDuration(180).withEndAction(() -> {
                settingsPanel.setVisibility(View.GONE);
                settingsPanel.setTranslationX(0f);
            }).start();
        } else {
            panelScrim.setVisibility(View.GONE);
            settingsPanel.setVisibility(View.GONE);
        }
        scheduleControlsHide();
    }

    private void populateQualityOptions() {
        qualityOptions.removeAllViews();
        boolean adaptive = !usingVlc && availableVideoHeights.size() > 1;
        qualityHint.setText(adaptive ? R.string.player_quality_adaptive_hint : R.string.player_quality_original_hint);
        if (!adaptive) {
            addQualityOption(getString(R.string.player_quality_original), true, 0, false);
            return;
        }
        addQualityOption(getString(R.string.player_quality_auto), qualityHeight == 0, 0, true);
        for (int height : availableVideoHeights) addQualityOption(qualityLabel(height), qualityHeight == height, height, true);
    }

    private void addQualityOption(String label, boolean selected, int height, boolean enabled) {
        TextView option = new TextView(this);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(46));
        params.bottomMargin = dp(9);
        option.setLayoutParams(params);
        option.setBackgroundResource(R.drawable.player_setting_option);
        option.setGravity(android.view.Gravity.CENTER_VERTICAL);
        option.setPadding(dp(15), 0, dp(15), 0);
        option.setText(label);
        option.setTextSize(13);
        option.setTypeface(option.getTypeface(), android.graphics.Typeface.BOLD);
        option.setSelected(selected);
        option.setTextColor(selected ? Color.rgb(11, 11, 16) : Color.rgb(247, 245, 240));
        option.setAlpha(enabled ? 1f : 0.72f);
        if (enabled) option.setOnClickListener(view -> setQualityHeight(height));
        qualityOptions.addView(option);
    }

    private void setQualityHeight(int height) {
        qualityHeight = height;
        savePreferences();
        applyQualityPreference();
        updateQualityButton();
        populateQualityOptions();
    }

    private void applyQualityPreference() {
        if (player == null || availableVideoHeights.size() <= 1) return;
        androidx.media3.common.TrackSelectionParameters.Builder builder = player.getTrackSelectionParameters().buildUpon();
        if (qualityHeight <= 0) builder.clearVideoSizeConstraints();
        else builder.setMaxVideoSize(Integer.MAX_VALUE, qualityHeight);
        player.setTrackSelectionParameters(builder.build());
        appliedQualityHeight = qualityHeight;
    }

    private void updateQualityButton() {
        if (usingVlc || availableVideoHeights.size() <= 1) {
            if (availableVideoHeights.size() == 1) qualityButton.setText(getString(R.string.player_quality_original) + " " + qualityLabel(availableVideoHeights.iterator().next()));
            else qualityButton.setText(R.string.player_quality_original);
        } else {
            if (qualityHeight <= 0) qualityButton.setText(R.string.player_quality_auto);
            else qualityButton.setText(qualityLabel(qualityHeight));
        }
    }

    private String qualityLabel(int height) {
        if (height >= 2160) return "4K";
        if (height >= 1440) return "2K";
        return height + "p";
    }

    private void togglePlayback() {
        if (vlcPlayer != null) {
            if (vlcPlayer.isPlaying()) {
                vlcPlayer.pause();
                setDanmakuAnimationsPaused(true);
            } else {
                vlcPlayer.play();
                handler.postDelayed(this::syncDanmakuPlaybackState, 80);
            }
        } else if (player != null) {
            if (player.isPlaying()) {
                player.pause();
                setDanmakuAnimationsPaused(true);
            } else {
                player.play();
                handler.postDelayed(this::syncDanmakuPlaybackState, 80);
            }
        }
        updatePlayPauseButton();
        showControls(true);
    }

    private void updatePlayPauseButton() {
        boolean playing = vlcPlayer != null ? vlcPlayer.isPlaying() : player != null && player.isPlaying();
        playPauseButton.setImageResource(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);
    }

    private void updateProgress() {
        syncDanmakuPlaybackState();
        if (seeking) return;
        long current = currentPosition();
        long length = currentDuration();
        if (length > 0) {
            duration = length;
            seekBar.setProgress((int) Math.min(1000, current * 1000 / length));
        }
        timeView.setText(formatTime(current) + " / " + formatTime(length));
        updatePlayPauseButton();
        if (isPlaybackPlaying()) updateDanmaku(current);
    }

    private void setDanmakuEnabled(boolean enabled) {
        danmakuEnabled = enabled;
        preferences.edit().putBoolean(PREF_DANMAKU_ENABLED, enabled).apply();
        if (!enabled) clearActiveDanmaku();
        else resetDanmaku(currentPosition());
        updateDanmakuButton();
        showControls(true);
    }

    private void updateDanmakuButton() {
        boolean available = !danmakuEntries.isEmpty();
        danmakuButton.setVisibility(View.VISIBLE);
        danmakuButton.setEnabled(available);
        danmakuButton.setSelected(available && danmakuEnabled);
        danmakuButton.setText(!available ? R.string.player_danmaku_unavailable : !danmakuEnabled ? R.string.player_danmaku_off : R.string.player_danmaku_on);
        danmakuButton.setAlpha(!available ? 0.48f : danmakuEnabled ? 1f : 0.72f);
        boolean showSource = danmakuEnabled && !danmakuSource.isEmpty();
        danmakuSourceView.setVisibility(showSource ? View.VISIBLE : View.GONE);
        if (showSource) danmakuSourceView.setText(getString(R.string.player_danmaku_source, danmakuSource));
        updateDanmakuSettingsUi();
    }

    private void updateDanmakuSettingsUi() {
        if (danmakuSettingsToggle == null || danmakuSettingsStatus == null) return;
        boolean available = !danmakuEntries.isEmpty();
        danmakuSettingsToggle.setEnabled(available);
        danmakuSettingsToggle.setSelected(available && danmakuEnabled);
        danmakuSettingsToggle.setText(!available ? R.string.player_unavailable : danmakuEnabled ? R.string.player_enabled : R.string.player_disabled);
        danmakuSettingsToggle.setTextColor(available && danmakuEnabled ? Color.rgb(11, 11, 16) : Color.rgb(247, 245, 240));
        danmakuSettingsToggle.setAlpha(available ? 1f : 0.55f);
        danmakuSettingsStatus.setText(available
            ? danmakuSource.isEmpty() ? getString(R.string.player_danmaku_count, danmakuEntries.size()) : danmakuSource
            : danmakuSource.isEmpty() ? getString(R.string.player_danmaku_not_loaded) : danmakuSource);
        setToggleState(danmakuScrollingToggle, danmakuScrolling);
        setToggleState(danmakuTopToggle, danmakuTop);
        setToggleState(danmakuBottomToggle, danmakuBottom);
        setToggleState(danmakuColorToggle, danmakuColor);
        setToggleState(danmakuProtectSubtitlesToggle, danmakuProtectSubtitles);
        setToggleState(danmakuSmartCollisionToggle, danmakuSmartCollision);
        setToggleState(danmakuScaleWithScreenToggle, danmakuScaleWithScreen);
        danmakuAreaSeek.setProgress(danmakuArea);
        danmakuOpacitySeek.setProgress(danmakuOpacity);
        danmakuSizeSeek.setProgress(danmakuSize);
        danmakuSpeedSeek.setProgress(danmakuSpeed);
        danmakuAreaValue.setText(getString(R.string.player_danmaku_percent_value, danmakuAreaPercent()));
        danmakuOpacityValue.setText(getString(R.string.player_danmaku_percent_value, danmakuOpacityPercent()));
        danmakuSizeValue.setText(getString(R.string.player_danmaku_percent_value, danmakuSizePercent()));
        danmakuSpeedValue.setText(danmakuSpeedLabel());
    }

    private void setToggleState(TextView view, boolean selected) {
        if (view == null) return;
        view.setSelected(selected);
        view.setTextColor(selected ? Color.rgb(11, 11, 16) : Color.rgb(247, 245, 240));
        view.setAlpha(selected ? 1f : 0.72f);
    }

    private void resetDanmaku(long position) {
        clearActiveDanmaku();
        int low = 0;
        int high = danmakuEntries.size();
        long target = Math.max(0, position - 250);
        while (low < high) {
            int middle = (low + high) >>> 1;
            if (danmakuEntries.get(middle).time < target) low = middle + 1;
            else high = middle;
        }
        danmakuCursor = low;
        lastDanmakuPosition = position;
    }

    private void updateDanmaku(long position) {
        if (!isPlaybackPlaying() || !danmakuEnabled || danmakuEntries.isEmpty() || danmakuOverlay.getWidth() <= 0) return;
        if (lastDanmakuPosition < 0 || Math.abs(position - lastDanmakuPosition) > 1600) resetDanmaku(position);
        long upper = position + 260;
        int emitted = 0;
        while (danmakuCursor < danmakuEntries.size() && danmakuEntries.get(danmakuCursor).time <= upper && emitted < 18) {
            DanmakuEntry entry = danmakuEntries.get(danmakuCursor++);
            if (entry.time >= position - 700 && shouldShowDanmaku(entry)) showDanmaku(entry);
            emitted += 1;
        }
        lastDanmakuPosition = position;
    }

    private void showDanmaku(DanmakuEntry entry) {
        TextView text = new TextView(this);
        text.setText(entry.text);
        text.setTextColor(entry.color | 0xff000000);
        text.setTextSize(15f * danmakuSizePercent() / 100f * danmakuScreenScale());
        text.setAlpha(danmakuOpacityPercent() / 100f);
        text.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        text.setSingleLine(true);
        text.setShadowLayer(dp(2), 0, dp(1), Color.BLACK);
        text.setPadding(dp(4), dp(2), dp(4), dp(2));
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        danmakuOverlay.addView(text, params);
        text.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED);
        int laneHeight = Math.max(dp(28), text.getMeasuredHeight() + dp(7));
        int top = dp(42);
        int bottom = Math.max(top + laneHeight, danmakuOverlay.getHeight() * danmakuAreaPercent() / 100);
        if (danmakuProtectSubtitles) bottom = Math.min(bottom, danmakuOverlay.getHeight() - dp(108));
        int laneCount = Math.max(1, Math.min(12, (bottom - top) / laneHeight));
        if (entry.mode == 4 || entry.mode == 5) {
            int lane = findFixedLane(entry.mode, laneCount);
            if (lane < 0) {
                danmakuOverlay.removeView(text);
                return;
            }
            text.setX(Math.max(0, (danmakuOverlay.getWidth() - text.getMeasuredWidth()) / 2f));
            text.setY(entry.mode == 4
                ? Math.max(top, bottom - (lane + 1) * laneHeight)
                : top + lane * laneHeight);
            ValueAnimator timer = ValueAnimator.ofFloat(0f, 1f);
            timer.setDuration(Math.max(2200, Math.round(danmakuDurationMs() * 0.55f / playbackRate())));
            startDanmakuAnimator(text, timer, lane, entry.mode);
            return;
        }
        int lane = findScrollingLane(laneCount);
        if (lane < 0) {
            danmakuOverlay.removeView(text);
            return;
        }
        text.setX(danmakuOverlay.getWidth());
        text.setY(top + lane * laneHeight);
        float distanceScale = (danmakuOverlay.getWidth() + text.getMeasuredWidth())
            / (float) Math.max(1, danmakuOverlay.getWidth() + dp(180));
        long durationMs = Math.round(danmakuDurationMs() * Math.max(0.82f, Math.min(1.35f, distanceScale)) / playbackRate());
        ObjectAnimator animator = ObjectAnimator.ofFloat(text, View.TRANSLATION_X, text.getTranslationX(), -text.getMeasuredWidth());
        animator.setDuration(Math.max(1800, durationMs));
        animator.setInterpolator(new LinearInterpolator());
        startDanmakuAnimator(text, animator, lane, 1);
    }

    private boolean shouldShowDanmaku(DanmakuEntry entry) {
        if (!danmakuColor && (entry.color & 0xFFFFFF) != 0xFFFFFF) return false;
        if (entry.mode == 4) return danmakuBottom;
        if (entry.mode == 5) return danmakuTop;
        return danmakuScrolling;
    }

    private int findScrollingLane(int laneCount) {
        int start = danmakuLane++ % laneCount;
        for (int offset = 0; offset < laneCount; offset++) {
            int lane = (start + offset) % laneCount;
            boolean ready = true;
            for (ActiveDanmaku active : activeDanmaku) {
                if (active.mode == 1 && active.lane == lane
                    && active.view.getX() + active.view.getWidth() > danmakuOverlay.getWidth() * 0.78f) {
                    ready = false;
                    break;
                }
            }
            if (ready) return lane;
        }
        return danmakuSmartCollision ? -1 : start;
    }

    private int findFixedLane(int mode, int laneCount) {
        int start = danmakuLane++ % laneCount;
        for (int offset = 0; offset < laneCount; offset++) {
            int lane = (start + offset) % laneCount;
            boolean occupied = false;
            for (ActiveDanmaku active : activeDanmaku) {
                if (active.mode == mode && active.lane == lane) {
                    occupied = true;
                    break;
                }
            }
            if (!occupied) return lane;
        }
        return danmakuSmartCollision ? -1 : start;
    }

    private void startDanmakuAnimator(TextView view, Animator animator, int lane, int mode) {
        ActiveDanmaku active = new ActiveDanmaku(view, animator, lane, mode);
        activeDanmaku.add(active);
        animator.addListener(new AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(Animator animation) {
                activeDanmaku.remove(active);
                if (view.getParent() == danmakuOverlay) danmakuOverlay.removeView(view);
            }
        });
        animator.start();
        if (danmakuPlaybackPaused || !isPlaybackPlaying()) animator.pause();
    }

    private void clearActiveDanmaku() {
        List<ActiveDanmaku> snapshot = new ArrayList<>(activeDanmaku);
        activeDanmaku.clear();
        for (ActiveDanmaku active : snapshot) active.animator.cancel();
        if (danmakuOverlay != null) danmakuOverlay.removeAllViews();
    }

    private boolean isPlaybackPlaying() {
        return vlcPlayer != null ? vlcPlayer.isPlaying() : player != null && player.isPlaying();
    }

    private void syncDanmakuPlaybackState() {
        setDanmakuAnimationsPaused(!isPlaybackPlaying());
    }

    private void setDanmakuAnimationsPaused(boolean paused) {
        danmakuPlaybackPaused = paused;
        for (ActiveDanmaku active : new ArrayList<>(activeDanmaku)) {
            if (!active.animator.isStarted()) continue;
            if (paused && !active.animator.isPaused()) active.animator.pause();
            else if (!paused && active.animator.isPaused()) active.animator.resume();
        }
    }

    private int danmakuAreaPercent() {
        return (Math.max(0, Math.min(9, danmakuArea)) + 1) * 10;
    }

    private int danmakuOpacityPercent() {
        return (Math.max(0, Math.min(9, danmakuOpacity)) + 1) * 10;
    }

    private int danmakuSizePercent() {
        return 50 + Math.max(0, Math.min(10, danmakuSize)) * 10;
    }

    private float danmakuScreenScale() {
        if (!danmakuScaleWithScreen || danmakuOverlay == null || danmakuOverlay.getWidth() <= 0) return 1f;
        float widthDp = danmakuOverlay.getWidth() / getResources().getDisplayMetrics().density;
        return Math.max(0.85f, Math.min(1.2f, widthDp / 800f));
    }

    private long danmakuDurationMs() {
        long[] durations = { 4200, 5600, 7600, 9800, 12200 };
        return durations[Math.max(0, Math.min(durations.length - 1, danmakuSpeed))];
    }

    private String danmakuSpeedLabel() {
        String[] labels = {
            getString(R.string.player_danmaku_speed_fastest),
            getString(R.string.player_danmaku_speed_fast),
            getString(R.string.player_danmaku_speed_normal),
            getString(R.string.player_danmaku_speed_slow),
            getString(R.string.player_danmaku_speed_slowest),
        };
        return labels[Math.max(0, Math.min(labels.length - 1, danmakuSpeed))];
    }

    private float playbackRate() {
        return player == null ? 1f : Math.max(0.25f, player.getPlaybackParameters().speed);
    }

    private void setDebugEnabled(boolean enabled) {
        debugEnabled = enabled;
        savePreferences();
        lastDebugUiUpdateMs = 0;
        updateDebugVisibility();
        if (enabled) {
            updateDebugInfo();
            showControls(true);
        }
    }

    private void updateDebugVisibility() {
        debugPanel.setVisibility(debugEnabled ? View.VISIBLE : View.GONE);
        debugButton.setSelected(debugEnabled);
        debugButton.setText(debugEnabled ? R.string.player_debug_on : R.string.player_debug);
        debugButton.setAlpha(debugEnabled ? 1f : 0.88f);
    }

    private void resetMedia3DebugMetrics() {
        videoDecoderName = "等待初始化";
        audioDecoderName = "等待初始化";
        lastPlaybackError = "";
        media3VideoFormat = null;
        media3AudioFormat = null;
        media3VideoCounters = null;
        streamBitsPerSecond = 0;
        playbackFps = 0;
        hasPlaybackFpsSample = false;
        lastFrameSampleMs = 0;
        lastRenderedFrames = 0;
        lastDebugUiUpdateMs = 0;
    }

    private void updateDebugInfo() {
        if (!debugEnabled) return;
        long now = SystemClock.elapsedRealtime();
        if (lastDebugUiUpdateMs > 0 && now - lastDebugUiUpdateMs < 900) return;
        lastDebugUiUpdateMs = now;
        debugText.setText(usingVlc ? buildVlcDebugText(now) : buildMedia3DebugText(now));
    }

    private String buildMedia3DebugText(long now) {
        updateMedia3FrameRate(now);
        Format video = media3VideoFormat != null ? media3VideoFormat : player == null ? null : player.getVideoFormat();
        Format audio = media3AudioFormat != null ? media3AudioFormat : player == null ? null : player.getAudioFormat();
        int dropped = 0;
        int rendered = 0;
        if (media3VideoCounters != null) {
            media3VideoCounters.ensureUpdated();
            dropped = media3VideoCounters.droppedBufferCount;
            rendered = media3VideoCounters.renderedOutputBufferCount;
        }
        long bufferedMs = player == null ? 0 : Math.max(0, player.getBufferedPosition() - player.getCurrentPosition());
        StringBuilder text = new StringBuilder();
        appendDebugRow(text, "播放器", "Media3 " + MediaLibraryInfo.VERSION);
        appendDebugRow(text, "状态", media3PlaybackState() + " · " + decoderMode(videoDecoderName));
        appendDebugRow(text, "视频解码", videoDecoderName);
        appendDebugRow(text, "音频解码", audioDecoderName);
        appendDebugRow(text, "视频流", media3VideoDescription(video));
        appendDebugRow(text, "音频流", media3AudioDescription(audio));
        appendDebugRow(text, "实时流速", formatBitrate(streamBitsPerSecond));
        appendDebugRow(text, "实际渲染帧率", frameAndDropDescription(playbackFps, hasPlaybackFpsSample, rendered, dropped));
        appendDebugRow(text, "缓冲", String.format(Locale.US, "%.1f 秒", bufferedMs / 1000f));
        if (!lastPlaybackError.isEmpty()) appendDebugRow(text, "最近错误", lastPlaybackError);
        return text.toString().trim();
    }

    private String buildVlcDebugText(long now) {
        IMedia media = vlcPlayer == null ? null : vlcPlayer.getMedia();
        IMedia.Stats stats = media == null ? null : media.getStats();
        if (stats != null) updateVlcRates(stats, now);
        IMedia.VideoTrack videoTrack = vlcPlayer == null ? null : vlcPlayer.getCurrentVideoTrack();
        IMedia.AudioTrack audioTrack = firstVlcAudioTrack(media);
        int displayed = stats == null ? 0 : stats.displayedPictures;
        int lost = stats == null ? 0 : stats.lostPictures;
        StringBuilder text = new StringBuilder();
        appendDebugRow(text, "播放器", "VLC 3.7.5 · 兼容模式");
        appendDebugRow(text, "状态", vlcPlayer != null && vlcPlayer.isPlaying() ? "播放中 · 软件解码" : "已暂停 · 软件解码");
        appendDebugRow(text, "视频解码", "libavcodec / " + vlcCodecName(videoTrack == null ? null : videoTrack.codec));
        appendDebugRow(text, "视频流", vlcVideoDescription(videoTrack));
        appendDebugRow(text, "音频流", vlcAudioDescription(audioTrack));
        appendDebugRow(text, "实时流速", formatBitrate(streamBitsPerSecond));
        appendDebugRow(text, "实际渲染帧率", frameAndDropDescription(playbackFps, hasPlaybackFpsSample, displayed, lost));
        appendDebugRow(text, "缓冲", "由 VLC 内部管理");
        if (!lastPlaybackError.isEmpty()) appendDebugRow(text, "最近错误", lastPlaybackError);
        return text.toString().trim();
    }

    private void updateMedia3FrameRate(long now) {
        if (media3VideoCounters == null) return;
        media3VideoCounters.ensureUpdated();
        int rendered = media3VideoCounters.renderedOutputBufferCount;
        if (lastFrameSampleMs > 0 && now > lastFrameSampleMs && rendered >= lastRenderedFrames) {
            double sampledFps = player != null && player.isPlaying()
                    ? (rendered - lastRenderedFrames) * 1000d / (now - lastFrameSampleMs)
                    : 0;
            setPlaybackFpsSample(sampledFps);
        }
        lastRenderedFrames = rendered;
        lastFrameSampleMs = now;
    }

    private void updateVlcRates(IMedia.Stats stats, long now) {
        if (lastVlcStatsSampleMs > 0 && now > lastVlcStatsSampleMs) {
            long elapsed = now - lastVlcStatsSampleMs;
            long bytes = Integer.toUnsignedLong(stats.readBytes);
            if (bytes >= lastVlcReadBytes) streamBitsPerSecond = (bytes - lastVlcReadBytes) * 8_000L / elapsed;
            if (stats.displayedPictures >= lastVlcDisplayedPictures) {
                double sampledFps = vlcPlayer != null && vlcPlayer.isPlaying()
                        ? (stats.displayedPictures - lastVlcDisplayedPictures) * 1000d / elapsed
                        : 0;
                setPlaybackFpsSample(sampledFps);
            }
        }
        lastVlcReadBytes = Integer.toUnsignedLong(stats.readBytes);
        lastVlcDisplayedPictures = stats.displayedPictures;
        lastVlcStatsSampleMs = now;
    }

    private void setPlaybackFpsSample(double sampledFps) {
        if (sampledFps < 0 || sampledFps > 240) return;
        hasPlaybackFpsSample = true;
        playbackFps = sampledFps;
    }

    private IMedia.AudioTrack firstVlcAudioTrack(IMedia media) {
        if (media == null) return null;
        int count = media.getTrackCount();
        for (int index = 0; index < count; index++) {
            IMedia.Track track = media.getTrack(index);
            if (track instanceof IMedia.AudioTrack) return (IMedia.AudioTrack) track;
        }
        return null;
    }

    private String media3PlaybackState() {
        if (player == null) return "初始化中";
        if (player.getPlaybackState() == Player.STATE_BUFFERING) return "缓冲中";
        if (player.getPlaybackState() == Player.STATE_ENDED) return "已结束";
        if (player.isPlaying()) return "播放中";
        return "已暂停";
    }

    private String decoderMode(String decoderName) {
        if (decoderName == null || decoderName.startsWith("等待")) return "解码器初始化中";
        String normalized = decoderName.toLowerCase(Locale.US);
        boolean software = normalized.contains("google") || normalized.contains("android") || normalized.contains("ffmpeg") || normalized.contains("software");
        return software ? "软件解码" : "硬件解码";
    }

    private String media3VideoDescription(Format format) {
        if (format == null) return "等待视频轨道";
        String resolution = format.width > 0 && format.height > 0 ? format.width + "×" + format.height : "未知分辨率";
        String fps = format.frameRate > 0 ? String.format(Locale.US, "%.2f fps", format.frameRate) : "未知帧率";
        return codecName(format.sampleMimeType, format.codecs) + " · " + resolution + " · " + fps;
    }

    private String media3AudioDescription(Format format) {
        if (format == null) return "等待音频轨道";
        String channels = format.channelCount > 0 ? format.channelCount + " 声道" : "未知声道";
        String rate = format.sampleRate > 0 ? String.format(Locale.US, "%.1f kHz", format.sampleRate / 1000f) : "未知采样率";
        return codecName(format.sampleMimeType, format.codecs) + " · " + channels + " · " + rate;
    }

    private String vlcVideoDescription(IMedia.VideoTrack track) {
        if (track == null) return "等待视频轨道";
        String resolution = track.width > 0 && track.height > 0 ? track.width + "×" + track.height : "未知分辨率";
        float fps = track.frameRateDen == 0 ? 0 : (float) track.frameRateNum / track.frameRateDen;
        String fpsText = fps > 0 ? String.format(Locale.US, "%.2f fps", fps) : "未知帧率";
        return vlcCodecName(track.codec) + " · " + resolution + " · " + fpsText;
    }

    private String vlcAudioDescription(IMedia.AudioTrack track) {
        if (track == null) return "等待音频轨道";
        String channels = track.channels > 0 ? track.channels + " 声道" : "未知声道";
        String rate = track.rate > 0 ? String.format(Locale.US, "%.1f kHz", track.rate / 1000f) : "未知采样率";
        return vlcCodecName(track.codec) + " · " + channels + " · " + rate;
    }

    private String codecName(String mimeType, String codec) {
        String value = ((mimeType == null ? "" : mimeType) + " " + (codec == null ? "" : codec)).toLowerCase(Locale.US);
        if (value.contains("hevc") || value.contains("h265") || value.contains("hvc1")) return "HEVC / H.265";
        if (value.contains("avc") || value.contains("h264")) return "AVC / H.264";
        if (value.contains("av01") || value.contains("av1")) return "AV1";
        if (value.contains("vp9")) return "VP9";
        if (value.contains("flac")) return "FLAC";
        if (value.contains("eac3")) return "E-AC-3";
        if (value.contains("ac3")) return "AC-3";
        if (value.contains("opus")) return "Opus";
        if (value.contains("aac") || value.contains("mp4a")) return "AAC";
        if (codec != null && !codec.isEmpty()) return codec;
        if (mimeType != null && mimeType.contains("/")) return mimeType.substring(mimeType.indexOf('/') + 1).toUpperCase(Locale.US);
        return "未知";
    }

    private String vlcCodecName(String codec) {
        return codecName(codec, codec);
    }

    private String frameAndDropDescription(double actualFps, boolean hasSample, int rendered, int dropped) {
        String fps = hasSample ? String.format(Locale.US, "%.1f fps", actualFps) : "等待采样";
        int total = Math.max(0, rendered) + Math.max(0, dropped);
        if (total <= 0) return fps + " · 丢帧 0";
        return fps + String.format(Locale.US, " · 丢帧 %d（%.2f%%）", dropped, dropped * 100d / total);
    }

    private String formatBitrate(long bitsPerSecond) {
        if (bitsPerSecond <= 0) return "等待采样";
        if (bitsPerSecond >= 1_000_000) return String.format(Locale.US, "%.2f Mbps · %.2f MB/s", bitsPerSecond / 1_000_000d, bitsPerSecond / 8_000_000d);
        return String.format(Locale.US, "%.0f Kbps", bitsPerSecond / 1000d);
    }

    private void appendDebugRow(StringBuilder text, String label, String value) {
        if (text.length() > 0) text.append('\n');
        text.append(String.format(Locale.CHINA, "%-5s  %s", label, value));
    }

    private long currentPosition() {
        if (vlcPlayer != null) return Math.max(0, vlcPlayer.getTime());
        if (player != null) return Math.max(0, player.getCurrentPosition());
        return Math.max(0, resumePosition);
    }

    private long currentDuration() {
        if (vlcPlayer != null) return Math.max(0, vlcPlayer.getLength());
        if (player != null && player.getDuration() != C.TIME_UNSET) return Math.max(0, player.getDuration());
        return Math.max(0, duration);
    }

    private void toggleControls() {
        if (settingsPanel.getVisibility() == View.VISIBLE) return;
        if (controlsVisible) hideControls(); else showControls(true);
    }

    private void showControls(boolean autoHide) {
        handler.removeCallbacks(hideControlsRunnable);
        controlsVisible = true;
        controlsOverlay.setVisibility(View.VISIBLE);
        controlsOverlay.animate().cancel();
        if (animationsEnabled()) controlsOverlay.animate().alpha(1f).setDuration(160).start();
        else controlsOverlay.setAlpha(1f);
        if (autoHide) scheduleControlsHide();
    }

    private void hideControls() {
        if (seeking || settingsPanel.getVisibility() == View.VISIBLE) return;
        boolean playing = vlcPlayer != null ? vlcPlayer.isPlaying() : player != null && player.isPlaying();
        if (!playing) return;
        controlsVisible = false;
        if (animationsEnabled()) {
            controlsOverlay.animate().alpha(0f).setDuration(180).withEndAction(() -> {
                if (!controlsVisible) controlsOverlay.setVisibility(View.GONE);
            }).start();
        } else {
            controlsOverlay.setAlpha(0f);
            controlsOverlay.setVisibility(View.GONE);
        }
    }

    private void scheduleControlsHide() {
        handler.removeCallbacks(hideControlsRunnable);
        if (settingsPanel.getVisibility() != View.VISIBLE) handler.postDelayed(hideControlsRunnable, CONTROLS_TIMEOUT_MS);
    }

    private void updateSubtitleButton() {
        subtitleButton.setVisibility(View.VISIBLE);
        subtitleButton.setText(R.string.player_display_settings);
        subtitleButton.setAlpha(1f);
    }

    private void updateSettingsUi() {
        setSelected(R.id.subtitle_style_original, STYLE_ORIGINAL.equals(subtitleStyle));
        setSelected(R.id.subtitle_style_outline, STYLE_OUTLINE.equals(subtitleStyle));
        setSelected(R.id.subtitle_style_yellow, STYLE_YELLOW.equals(subtitleStyle));
        setSelected(R.id.subtitle_style_box, STYLE_BOX.equals(subtitleStyle));
        setSelected(R.id.subtitle_color_white, subtitleColor == 0);
        setSelected(R.id.subtitle_color_yellow, subtitleColor == 1);
        setSelected(R.id.subtitle_color_cyan, subtitleColor == 2);
        subtitleSizeSeek.setProgress(subtitleSize);
        subtitlePositionSeek.setProgress(subtitlePosition);
        subtitleOutlineSeek.setProgress(subtitleOutline);
        subtitleBackgroundSeek.setProgress(subtitleBackground);
        subtitleSizeValue.setText(getString(R.string.player_subtitle_size_value, subtitleFontSp()));
        subtitlePositionValue.setText(getString(R.string.player_subtitle_position_value, 3 + subtitlePosition * 2));
        subtitleOutlineValue.setText(getString(R.string.player_subtitle_outline_value, subtitleOutline));
        subtitleBackgroundValue.setText(getString(R.string.player_subtitle_background_value, subtitleBackground * 10));
        subtitleToggle.setSelected(subtitlesEnabled);
        subtitleToggle.setText(subtitlesEnabled ? R.string.player_enabled : R.string.player_disabled);
        subtitleToggle.setTextColor(subtitlesEnabled ? Color.rgb(11, 11, 16) : Color.rgb(247, 245, 240));
        subtitleCompatibilityNote.setVisibility(usingVlc ? View.VISIBLE : View.GONE);
        updateDanmakuSettingsUi();
    }

    private void setSelected(int viewId, boolean selected) {
        TextView view = findViewById(viewId);
        view.setSelected(selected);
        view.setTextColor(selected ? Color.rgb(11, 11, 16) : Color.rgb(247, 245, 240));
    }

    private void loadPreferences() {
        subtitlesEnabled = preferences.getBoolean(PREF_SUBTITLES_ENABLED, true);
        subtitleStyle = preferences.getString(PREF_SUBTITLE_STYLE, STYLE_ORIGINAL);
        subtitleSize = preferences.getInt(PREF_SUBTITLE_SIZE_LEVEL, 4);
        subtitlePosition = preferences.getInt(PREF_SUBTITLE_POSITION_LEVEL, 3);
        subtitleColor = preferences.getInt(PREF_SUBTITLE_COLOR, STYLE_YELLOW.equals(subtitleStyle) ? 1 : 0);
        subtitleOutline = preferences.getInt(PREF_SUBTITLE_OUTLINE, STYLE_BOX.equals(subtitleStyle) ? 0 : 3);
        subtitleBackground = preferences.getInt(PREF_SUBTITLE_BACKGROUND, STYLE_BOX.equals(subtitleStyle) ? 8 : 0);
        qualityHeight = preferences.getInt(PREF_QUALITY_HEIGHT, 0);
        debugEnabled = preferences.getBoolean(PREF_DEBUG_ENABLED, false);
        danmakuEnabled = preferences.getBoolean(PREF_DANMAKU_ENABLED, true);
        danmakuScrolling = preferences.getBoolean(PREF_DANMAKU_SCROLLING, true);
        danmakuTop = preferences.getBoolean(PREF_DANMAKU_TOP, true);
        danmakuBottom = preferences.getBoolean(PREF_DANMAKU_BOTTOM, true);
        danmakuColor = preferences.getBoolean(PREF_DANMAKU_COLOR, true);
        danmakuArea = preferences.getInt(PREF_DANMAKU_AREA, 6);
        danmakuOpacity = preferences.getInt(PREF_DANMAKU_OPACITY, 9);
        danmakuSize = preferences.getInt(PREF_DANMAKU_SIZE, 5);
        danmakuSpeed = preferences.getInt(PREF_DANMAKU_SPEED, 2);
        danmakuProtectSubtitles = preferences.getBoolean(PREF_DANMAKU_PROTECT_SUBTITLES, true);
        danmakuSmartCollision = preferences.getBoolean(PREF_DANMAKU_SMART_COLLISION, true);
        danmakuScaleWithScreen = preferences.getBoolean(PREF_DANMAKU_SCALE_WITH_SCREEN, true);
    }

    private void savePreferences() {
        preferences.edit()
            .putBoolean(PREF_SUBTITLES_ENABLED, subtitlesEnabled)
            .putString(PREF_SUBTITLE_STYLE, subtitleStyle)
            .putInt(PREF_SUBTITLE_SIZE_LEVEL, subtitleSize)
            .putInt(PREF_SUBTITLE_POSITION_LEVEL, subtitlePosition)
            .putInt(PREF_SUBTITLE_COLOR, subtitleColor)
            .putInt(PREF_SUBTITLE_OUTLINE, subtitleOutline)
            .putInt(PREF_SUBTITLE_BACKGROUND, subtitleBackground)
            .putInt(PREF_QUALITY_HEIGHT, qualityHeight)
            .putBoolean(PREF_DEBUG_ENABLED, debugEnabled)
            .putBoolean(PREF_DANMAKU_ENABLED, danmakuEnabled)
            .putBoolean(PREF_DANMAKU_SCROLLING, danmakuScrolling)
            .putBoolean(PREF_DANMAKU_TOP, danmakuTop)
            .putBoolean(PREF_DANMAKU_BOTTOM, danmakuBottom)
            .putBoolean(PREF_DANMAKU_COLOR, danmakuColor)
            .putInt(PREF_DANMAKU_AREA, danmakuArea)
            .putInt(PREF_DANMAKU_OPACITY, danmakuOpacity)
            .putInt(PREF_DANMAKU_SIZE, danmakuSize)
            .putInt(PREF_DANMAKU_SPEED, danmakuSpeed)
            .putBoolean(PREF_DANMAKU_PROTECT_SUBTITLES, danmakuProtectSubtitles)
            .putBoolean(PREF_DANMAKU_SMART_COLLISION, danmakuSmartCollision)
            .putBoolean(PREF_DANMAKU_SCALE_WITH_SCREEN, danmakuScaleWithScreen)
            .apply();
    }

    private void readSubtitles() {
        try {
            JSONArray array = payloadArray("subtitles", EXTRA_SUBTITLES);
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

    private void readDanmaku() {
        try {
            JSONArray array = payloadArray("danmaku", EXTRA_DANMAKU);
            for (int index = 0; index < array.length(); index++) {
                JSONObject item = array.optJSONObject(index);
                if (item == null) continue;
                String text = item.optString("text").trim();
                long time = item.optLong("time", -1);
                if (text.isEmpty() || time < 0) continue;
                danmakuEntries.add(new DanmakuEntry(time, item.optInt("mode", 1), item.optInt("color", 0xffffff), text));
            }
            danmakuEntries.sort((left, right) -> Long.compare(left.time, right.time));
        } catch (Exception ignored) {
            danmakuEntries.clear();
        }
    }

    private JSONArray payloadArray(String key, String legacyExtra) {
        if (playbackPayload != null) {
            JSONArray array = playbackPayload.optJSONArray(key);
            if (array != null) return array;
        }
        String raw = getIntent().getStringExtra(legacyExtra);
        try {
            return new JSONArray(raw == null ? "[]" : raw);
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private void captureProgress() {
        resumePosition = currentPosition();
        duration = currentDuration();
    }

    private void releasePlayer() {
        if (player == null) return;
        playerView.setPlayer(null);
        player.release();
        player = null;
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

    private String formatTime(long millis) {
        long totalSeconds = Math.max(0, millis / 1000);
        if (totalSeconds >= 3600) return String.format(Locale.US, "%d:%02d:%02d", totalSeconds / 3600, (totalSeconds / 60) % 60, totalSeconds % 60);
        return String.format(Locale.US, "%02d:%02d", totalSeconds / 60, totalSeconds % 60);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private boolean animationsEnabled() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ValueAnimator.areAnimatorsEnabled();
    }

    @Override
    protected void onStop() {
        captureProgress();
        handler.removeCallbacksAndMessages(null);
        clearActiveDanmaku();
        releasePlayer();
        releaseVlc();
        super.onStop();
    }

    @Override
    public void finish() {
        captureProgress();
        Intent result = new Intent();
        result.putExtra(RESULT_POSITION, resumePosition);
        result.putExtra(RESULT_DURATION, duration);
        setResult(Activity.RESULT_OK, result);
        PlayerPayloadStore.delete(getIntent().getStringExtra(EXTRA_PAYLOAD_PATH));
        super.finish();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        releasePlayer();
        releaseVlc();
        super.onDestroy();
    }

    private interface IntValueConsumer {
        void accept(int value);
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

    private static final class DanmakuEntry {
        final long time;
        final int mode;
        final int color;
        final String text;

        DanmakuEntry(long time, int mode, int color, String text) {
            this.time = time;
            this.mode = mode;
            this.color = color;
            this.text = text;
        }
    }

    private static final class ActiveDanmaku {
        final TextView view;
        final Animator animator;
        final int lane;
        final int mode;

        ActiveDanmaku(TextView view, Animator animator, int lane, int mode) {
            this.view = view;
            this.animator = animator;
            this.lane = lane;
            this.mode = mode;
        }
    }
}
