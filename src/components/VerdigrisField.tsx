"use client";

import { useEffect, useRef, useState } from "react";

/**
 * VerdigrisField — animated oxidised-copper background.
 *
 * Deliberately dependency-free: one WebGL1 program, one fullscreen
 * triangle, ~40 lines of GLSL. No three.js, nothing added to the bundle
 * beyond this file (~3 KB gzipped).
 *
 * Performance guards:
 *  · renders at 55% resolution and is CSS-upscaled — the field is soft,
 *    so nobody can tell, and it cuts fragment work by ~⅔
 *  · device pixel ratio capped at 1.5
 *  · rAF loop stops when the tab is hidden or the canvas scrolls away
 *  · prefers-reduced-motion renders a single static frame, no loop
 *  · no WebGL / context lost → unmounts cleanly and the CSS gradient
 *    underneath shows through
 */

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2  uRes;
uniform float uTime;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes.xy;
  vec2 p = uv;
  p.x *= uRes.x / uRes.y;
  p *= 1.6;

  float t = uTime * 0.045;

  // Two rounds of domain warping — this is what gives the field its
  // marbled, slowly-oxidising look rather than plain cloud noise.
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3 - t)));
  vec2 r = vec2(
    fbm(p + 4.0 * q + vec2(1.7, 9.2) + t * 0.7),
    fbm(p + 4.0 * q + vec2(8.3, 2.8) - t * 0.5)
  );
  float f = fbm(p + 4.0 * r);

  vec3 deep = vec3(0.031, 0.086, 0.082); // ink-900   #081615
  vec3 mid  = vec3(0.192, 0.471, 0.451); // verdigris #317873
  vec3 lite = vec3(0.588, 0.784, 0.733); // seaglass  #96C8BB
  vec3 glow = vec3(0.435, 0.851, 0.753); // patina    #6FD9C0

  vec3 col = mix(deep, mid, clamp(f * f * 2.3, 0.0, 1.0));
  col = mix(col, lite, clamp(length(r) * 0.55, 0.0, 1.0) * 0.45);
  col += glow * pow(clamp(q.x, 0.0, 1.0), 3.0) * 0.32;

  // Vignette keeps the centre readable for headline text
  float vig = smoothstep(1.25, 0.15, length(uv - vec2(0.5, 0.45)));
  col *= 0.32 + 0.68 * vig;

  // Fade the lower edge into the page background
  col = mix(deep, col, smoothstep(0.0, 0.5, uv.y));

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export default function VerdigrisField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl =
      (canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: "low-power",
        failIfMajorPerformanceCaveat: false,
      }) as WebGLRenderingContext | null) ??
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);

    if (!gl) {
      setFailed(true);
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      setFailed(true);
      return;
    }

    const prog = gl.createProgram();
    if (!prog) {
      setFailed(true);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFailed(true);
      return;
    }
    gl.useProgram(prog);

    // Single oversized triangle covers the viewport with no index buffer
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");

    const RES_SCALE = 0.55;
    const MAX_DPR = 1.5;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr * RES_SCALE));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr * RES_SCALE));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };

    const draw = (timeSeconds: number) => {
      gl.uniform1f(uTime, timeSeconds);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    resize();

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    // Reduced motion: paint one frame at a pleasant point in the loop.
    if (reduceMotion) {
      draw(12);
      const ro = new ResizeObserver(() => {
        resize();
        draw(12);
      });
      ro.observe(canvas);
      return () => {
        ro.disconnect();
        gl.deleteProgram(prog);
        gl.deleteBuffer(buf);
      };
    }

    let raf = 0;
    let running = true;
    let visible = true;
    const start = performance.now();

    const loop = () => {
      if (!running) return;
      resize();
      draw((performance.now() - start) / 1000);
      raf = requestAnimationFrame(loop);
    };

    const setRunning = (next: boolean) => {
      if (next === running) return;
      running = next;
      if (next) {
        raf = requestAnimationFrame(loop);
      } else {
        cancelAnimationFrame(raf);
      }
    };

    const onVisibility = () =>
      setRunning(!document.hidden && visible);

    // Stop burning GPU once the hero has scrolled off screen
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        setRunning(!document.hidden && visible);
      },
      { threshold: 0 }
    );
    io.observe(canvas);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      running = false;
      cancelAnimationFrame(raf);
      setFailed(true);
    };

    document.addEventListener("visibilitychange", onVisibility);
    canvas.addEventListener("webglcontextlost", onContextLost);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  if (failed) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
