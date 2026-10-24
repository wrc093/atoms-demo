/* A small software-rendered sculpture. Pointer drag, spring return, form unfolding. */
(() => {
  let dispose = () => {};
  function mount() {
    dispose();
    const stage = document.querySelector('.welcome-sculpture');
    if (!stage) return;
    const canvas = stage.querySelector('canvas');
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;
    const surface = stage.querySelector('.sculpture-interaction');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const prompt = document.querySelector('#home-prompt textarea');
    const state = { x: -.25, y: -.43, targetX: -.25, targetY: -.43, vx: 0, vy: 0, morph: 0, targetMorph: 0, velocity: 0 };
    let width = 1, height = 1, frame = 0, visible = true, dragging = false, dragged = false;
    let pointerX = 0, pointerY = 0, lastTime = 0, resting = 0;
    let dark = document.documentElement.dataset.theme === 'dark';
    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
    const rotate = point => {
      const cy = Math.cos(state.y), sy = Math.sin(state.y), cx = Math.cos(state.x), sx = Math.sin(state.x);
      const x = point[0] * cy + point[2] * sy;
      const z = -point[0] * sy + point[2] * cy;
      const y = point[1] * cx - z * sx;
      const zz = point[1] * sx + z * cx;
      const rz = -.18 * (1 - state.morph), cz = Math.cos(rz), sz = Math.sin(rz);
      return [x * cz - y * sz, x * sz + y * cz, zz];
    };
    function point(u, v, layer) {
      const phase = layer * .82;
      const folded = [u * 1.36 + (layer - 1) * .11, v * .49 + (layer - 1) * .55 + Math.sin(u * 2.5 + phase) * .16, Math.sin(u * 2.2 + phase) * .5 + v * Math.sin(u * 2.1 + phase) * .4];
      const flat = layer === 0 ? [-.94 + u * .36, v * .84, .04] : layer === 1 ? [.39 + u * .93, v * .84, 0] : [u * 1.32, .94 + v * .09, .06];
      return rotate(folded.map((value, i) => lerp(value, flat[i], state.morph)));
    }
    function project(p) {
      const perspective = 4.8 / (4.8 - p[2]);
      const scale = Math.min(width * .235, height * .25);
      return [width / 2 + p[0] * scale * perspective, height * .44 - p[1] * scale * perspective];
    }
    function draw() {
      context.clearRect(0, 0, width, height);
      const shadow = context.createRadialGradient(width / 2, height * .84, 0, width / 2, height * .84, width * .31);
      shadow.addColorStop(0, dark ? 'rgba(0,0,0,.27)' : 'rgba(20,20,20,.09)');
      shadow.addColorStop(1, 'rgba(0,0,0,0)');
      context.save();context.translate(0, height * .67);context.scale(1, .21);context.fillStyle = shadow;context.fillRect(0, 0, width, height);context.restore();
      const faces = [];
      const columns = width < 300 ? 36 : 56, rows = width < 300 ? 10 : 14;
      for (let layer = 0; layer < 3; layer++) {
        const vertices = [];
        for (let i = 0; i <= columns; i++) for (let j = 0; j <= rows; j++) vertices.push(point(i / columns * 2 - 1, j / rows * 2 - 1, layer));
        for (let i = 0; i < columns; i++) for (let j = 0; j < rows; j++) {
          const a = vertices[i * (rows + 1) + j], b = vertices[(i + 1) * (rows + 1) + j], c = vertices[(i + 1) * (rows + 1) + j + 1], d = vertices[i * (rows + 1) + j + 1];
          const ab = b.map((value, k) => value - a[k]), ad = d.map((value, k) => value - a[k]);
          let normal = [ab[1] * ad[2] - ab[2] * ad[1], ab[2] * ad[0] - ab[0] * ad[2], ab[0] * ad[1] - ab[1] * ad[0]];
          const length = Math.hypot(...normal) || 1;normal = normal.map(n => n / length);
          const diffuse = Math.abs(normal[0] * -.35 + normal[1] * .62 + normal[2] * .7);
          const specular = Math.pow(Math.max(0, normal[0] * -.12 + normal[1] * .18 + normal[2] * .96), 22);
          const reflection = Math.pow(Math.max(0, 1 - Math.abs(normal[1] - .18)), 8);
          const luminance = clamp((dark ? 47 : 28) + diffuse * 112 + specular * 90 + reflection * 45 + layer * 4, 25, 242);
          faces.push({ vertices: [a,b,c,d], depth: (a[2]+b[2]+c[2]+d[2])/4, shade: Math.round(luminance) });
        }
      }
      faces.sort((a,b) => a.depth - b.depth);
      context.globalAlpha = clamp(1 - Math.max(0, (state.morph - .45) / .55),0,1);
      for (const face of faces) {
        const vertices = face.vertices.map(project);
        context.beginPath();vertices.forEach((p,i) => i ? context.lineTo(...p) : context.moveTo(...p));context.closePath();
        context.fillStyle = `rgb(${face.shade},${face.shade},${face.shade})`;context.strokeStyle=context.fillStyle;context.lineWidth=.65;context.fill();context.stroke();
      }
      context.globalAlpha=1;
      stage.style.setProperty('--unfold', String(clamp((state.morph - .35) / .65, 0, 1)));
      stage.style.setProperty('--sculpture-rx', `${state.x * -9}deg`);
      stage.style.setProperty('--sculpture-ry', `${state.y * 9}deg`);
    }
    function tick(time) {
      frame=0;
      const dt=Math.min((time-lastTime)/16.67 || 1,2);lastTime=time;
      for (const [value,target,velocity] of [['x','targetX','vx'],['y','targetY','vy'],['morph','targetMorph','velocity']]) {
        state[velocity] += (state[target] - state[value]) * .075 * dt;
        state[velocity] *= Math.pow(.72,dt);
        state[value] += state[velocity] * dt;
      }
      draw();
      const movement=Math.abs(state.vx)+Math.abs(state.vy)+Math.abs(state.velocity)+Math.abs(state.morph-state.targetMorph)+Math.abs(state.x-state.targetX)+Math.abs(state.y-state.targetY);
      resting=movement<.0002?resting+1:0;
      if(visible&&!document.hidden&&(dragging||resting<12))frame=requestAnimationFrame(tick);
    }
    function wake() {if(reduced.matches){state.x=state.targetX;state.y=state.targetY;state.morph=state.targetMorph;state.vx=state.vy=state.velocity=0;draw();return;}resting=0;if(!frame&&visible&&!document.hidden)frame=requestAnimationFrame(tick);}
    function mode(value) {
      state.targetMorph=value;
      stage.dataset.mode=value?'interface':'idea';
      stage.querySelectorAll('[data-sculpture-mode]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.sculptureMode)===value)));
      stage.querySelector('.sculpture-caption').textContent=value?'从一个念头，到清晰的界面。':'拖动探索，让想法换个角度。';
      if(reduced.matches){state.morph=value;state.x=state.targetX;state.y=state.targetY;draw()}else wake();
    }
    function resize(){const box=surface.getBoundingClientRect();width=box.width;height=box.height;const ratio=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);context.setTransform(ratio,0,0,ratio,0,0);draw();wake();}
    function pointerDown(event){dragging=true;dragged=false;pointerX=event.clientX;pointerY=event.clientY;surface.setPointerCapture(event.pointerId);surface.classList.add('is-dragging');}
    function pointerMove(event){if(!dragging)return;const dx=event.clientX-pointerX,dy=event.clientY-pointerY;if(Math.abs(dx)+Math.abs(dy)>2)dragged=true;pointerX=event.clientX;pointerY=event.clientY;state.targetY=clamp(state.targetY+dx*.009,-1.2,1.2);state.targetX=clamp(state.targetX+dy*.008,-.9,.8);if(reduced.matches){state.y=state.targetY;state.x=state.targetX;draw()}else wake();}
    function pointerUp(){if(!dragging)return;dragging=false;surface.classList.remove('is-dragging');state.targetX=-.25;state.targetY=-.43;wake();}
    function surfaceClick(event){if(event.detail===0||!dragged)mode(state.targetMorph?0:1);dragged=false;}
    function modeClick(event){const button=event.target.closest('[data-sculpture-mode]');if(button)mode(Number(button.dataset.sculptureMode));}
    function input(){mode(prompt.value.trim().length>3?1:0);}
    function visibility(){if(!document.hidden)wake();else{cancelAnimationFrame(frame);frame=0;}}
    surface.addEventListener('pointerdown',pointerDown);surface.addEventListener('pointermove',pointerMove);surface.addEventListener('pointerup',pointerUp);surface.addEventListener('pointercancel',pointerUp);surface.addEventListener('click',surfaceClick);
    stage.addEventListener('click',modeClick);prompt?.addEventListener('input',input);document.addEventListener('visibilitychange',visibility);
    const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(surface);
    const viewObserver=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)wake();else{cancelAnimationFrame(frame);frame=0;}});viewObserver.observe(stage);
    const themeObserver=new MutationObserver(()=>{dark=document.documentElement.dataset.theme==='dark';draw()});themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    resize();if(prompt?.value.trim().length>3)mode(1);
    dispose=()=>{cancelAnimationFrame(frame);resizeObserver.disconnect();viewObserver.disconnect();themeObserver.disconnect();document.removeEventListener('visibilitychange',visibility);prompt?.removeEventListener('input',input);};
  }
  window.FormaSculpture={mount};
})();
