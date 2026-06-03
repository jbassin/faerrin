import {
  Application,
  Container,
  defaultFilterVert,
  Filter,
  GlProgram,
  Graphics,
} from "pixi.js";

// Pixi v8 filter convention: NO `#version` directive (Pixi prepends it), use
// `in`/`out` for varyings + individual top-level uniforms; the resource key
// (`balatroUniforms`) is the logical group name Pixi binds them under.
const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform float uTime;

#define SPIN_ROTATION -2.0
#define SPIN_SPEED 4.0
#define OFFSET vec2(0.0)
#define COLOUR_1 vec4(0.27, 0.42, 0.40, 1.0)
#define COLOUR_2 vec4(0.42, 0.32, 0.18, 1.0)
#define COLOUR_3 vec4(0.035, 0.047, 0.063, 1.0)
#define CONTRAST 2.5
#define LIGTHING 0.25
#define SPIN_AMOUNT 0.25
#define PIXEL_FILTER 745.0
#define SPIN_EASE 1.0
#define PI 3.14159265359
#define IS_ROTATE false

vec4 effect(vec2 screenSize, vec2 screen_coords) {
  float pixel_size = length(screenSize.xy) / PIXEL_FILTER;
  vec2 uv = (floor(screen_coords.xy * (1.0 / pixel_size)) * pixel_size - 0.5 * screenSize.xy) / length(screenSize.xy) - OFFSET;
  float uv_len = length(uv);

  float speed = (SPIN_ROTATION * SPIN_EASE * 0.2);
  if (IS_ROTATE) {
    speed = uTime * speed;
  }
  speed += 302.2;
  float new_pixel_angle = atan(uv.y, uv.x) + speed - SPIN_EASE * 20.0 * (1.0 * SPIN_AMOUNT * uv_len + (1.0 - 1.0 * SPIN_AMOUNT));
  vec2 mid = (screenSize.xy / length(screenSize.xy)) / 2.0;
  uv = (vec2((uv_len * cos(new_pixel_angle) + mid.x), (uv_len * sin(new_pixel_angle) + mid.y)) - mid);

  uv *= 30.0;
  speed = uTime * (SPIN_SPEED);
  vec2 uv2 = vec2(uv.x + uv.y);

  for (int i = 0; i < 5; i++) {
    uv2 += sin(max(uv.x, uv.y)) + uv;
    uv += 0.5 * vec2(cos(5.1123314 + 0.353 * uv2.y + speed * 0.131121), sin(uv2.x - 0.113 * speed));
    uv -= 1.0 * cos(uv.x + uv.y) - 1.0 * sin(uv.x * 0.711 - uv.y);
  }

  float contrast_mod = (0.25 * CONTRAST + 0.5 * SPIN_AMOUNT + 1.2);
  float paint_res = min(2.0, max(0.0, length(uv) * (0.035) * contrast_mod));
  float c1p = max(0.0, 1.0 - contrast_mod * abs(1.0 - paint_res));
  float c2p = max(0.0, 1.0 - contrast_mod * abs(paint_res));
  float c3p = 1.0 - min(1.0, c1p + c2p);
  float light = (LIGTHING - 0.2) * max(c1p * 5.0 - 4.0, 0.0) + LIGTHING * max(c2p * 5.0 - 4.0, 0.0);
  return (0.3 / CONTRAST) * COLOUR_1
    + (1.0 - 0.3 / CONTRAST) * (COLOUR_1 * c1p + COLOUR_2 * c2p + vec4(c3p * COLOUR_3.rgb, c3p * COLOUR_1.a))
    + light;
}

void main() {
  // gl_FragCoord is in framebuffer pixels (CSS px * resolution), but uInputSize.xy
  // is in CSS pixels — using gl_FragCoord directly desyncs the pattern from the
  // viewport on high-DPR devices and pushes it into the bottom-left corner. Derive
  // screen coords from vTextureCoord instead so both are in the same units.
  finalColor = effect(uInputSize.xy, vTextureCoord * uInputSize.xy);
}
`;

export interface BalatroBackground {
  mesh: Container;
  update: (elapsedMs: number) => void;
  destroy: () => void;
}

export function createBalatroBackground(app: Application): BalatroBackground {
  const glProgram = GlProgram.from({
    vertex: defaultFilterVert,
    fragment: FRAGMENT_SHADER,
    name: "balatro-filter",
  });

  const filter = new Filter({
    glProgram,
    resources: {
      balatroUniforms: {
        uTime: { value: 0, type: "f32" },
      },
    },
  });

  const rect = new Graphics().rect(0, 0, 1, 1).fill(0x000000);
  rect.label = "balatroBackground";
  rect.filters = [filter];

  const sync = () => {
    const { width, height } = app.renderer.screen;
    rect.scale.set(width, height);
  };
  sync();

  const update = (elapsedMs: number) => {
    sync();
    const uniforms = (
      filter.resources.balatroUniforms as {
        uniforms: { uTime: number };
      }
    ).uniforms;
    uniforms.uTime = elapsedMs / 1000;
  };

  const destroy = () => {
    rect.destroy();
    filter.destroy();
  };

  return { mesh: rect, update, destroy };
}
