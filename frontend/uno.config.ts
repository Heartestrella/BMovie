import { defineConfig, presetIcons, presetWind3 } from 'unocss'

export default defineConfig({
  presets: [presetWind3(), presetIcons()],
  theme: {
    colors: {
      canvas: '#090a0e',
      surface: '#11131a',
      ink: '#f2efe8',
      muted: '#9697a0',
      beam: '#8c83ff',
    },
  },
})
