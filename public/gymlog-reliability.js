(() => {
  'use strict';

  const PENDING_STATE_KEY = 'gymlog-web-pending-cloud-v1';
  const CLIENT_ID_KEY = 'gymlog-web-client-id-v1';
  const RECOVERY_PREFIX = 'gymlog-web-recovery-';
  const clientId = localStorage.getItem(CLIENT_ID_KEY) || `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(CLIENT_ID_KEY, clientId);

  let cloudRevision = 0;
  let cloudUpdatedAt = null;
  let cloudSaveInFlight = null;
  let cloudSaveQueued = false;
  let localSequence = 0;
  let nextSnapshotReason = null;
  let recoveryRunning = false;

  const STARTUP_HIDDEN_IDS = [
    'phase-grid',
    'previewContent',
    'activeExercises',
    'routinesList',
    'logList',
    'notesContent',
    'notesSections'
  ];

  function revealAppContent(){
    document.getElementById('gymlog-web-boot-cleanup')?.remove();
    STARTUP_HIDDEN_IDS.forEach(id => document.getElementById(id)?.style.removeProperty('visibility'));
  }

  function refreshCloudUi(){
    try{
      if(typeof refreshUiAfterSync === 'function') refreshUiAfterSync();
      else if(!restoreActiveWorkout()) renderWorkoutGrid();
    }finally{
      // The classic page hides data until startup completes. This reliability
      // layer replaces its cloud loader, so it must also release that guard.
      revealAppContent();
    }
  }

  function clone(value){
    return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }

  function cloudStatusElement(){
    let element = document.getElementById('gymCloudStatus');
    if(element) return element;
    element = document.createElement('button');
    element.id = 'gymCloudStatus';
    element.type = 'button';
    element.className = 'gym-cloud-status pending';
    element.setAttribute('aria-live', 'polite');
    element.title = 'Estado de sincronización privada';
    element.addEventListener('click', () => {
      if(typeof openModal === 'function') openModal('overlaySettings');
    });
    element.textContent = 'Nube: iniciando';
    document.body.appendChild(element);
    return element;
  }

  function setCloudStatus(kind, text){
    const element = cloudStatusElement();
    element.className = `gym-cloud-status ${kind}`;
    element.textContent = text;
  }

  function recordPendingState(){
    try{
      localSequence += 1;
      localStorage.setItem(PENDING_STATE_KEY, JSON.stringify({
        sequence:localSequence,
        revision:cloudRevision,
        savedAt:new Date().toISOString(),
        state
      }));
    }catch(error){
      console.warn('No se pudo guardar la cola local de nube.', error);
    }
  }

  function readPendingState(){
    try{
      const pending = JSON.parse(localStorage.getItem(PENDING_STATE_KEY) || 'null');
      if(!pending?.state || typeof pending.state !== 'object') return null;
      localSequence = Math.max(localSequence, Number(pending.sequence) || 0);
      return pending;
    }catch{
      return null;
    }
  }

  function preserveRecoveryState(label, value){
    try{
      const key = `${RECOVERY_PREFIX}${label}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      localStorage.setItem(key, JSON.stringify(value));
      const recoveryKeys = Object.keys(localStorage).filter(item => item.startsWith(RECOVERY_PREFIX)).sort();
      recoveryKeys.slice(0, Math.max(0, recoveryKeys.length - 5)).forEach(item => localStorage.removeItem(item));
      return key;
    }catch(error){
      console.warn('No se pudo crear la copia local de recuperación.', error);
      return null;
    }
  }

  function mergeByKey(remoteItems, localItems, keyOf, mergeItem){
    const result = new Map();
    (Array.isArray(remoteItems) ? remoteItems : []).forEach(item => result.set(keyOf(item), clone(item)));
    (Array.isArray(localItems) ? localItems : []).forEach(item => {
      const key = keyOf(item);
      const previous = result.get(key);
      result.set(key, previous && mergeItem ? mergeItem(previous, item) : clone(item));
    });
    return [...result.values()];
  }

  function mergeStates(remoteState, localState){
    const merged = { ...clone(remoteState || {}), ...clone(localState || {}) };
    merged.routines = mergeByKey(remoteState?.routines, localState?.routines, item => item?.id || JSON.stringify(item));
    merged.workoutLog = mergeByKey(
      remoteState?.workoutLog,
      localState?.workoutLog,
      item => item?.id || `${item?.date}-${item?.routineName}`,
      (remote, local) => ({ ...remote, ...local, health:{ ...(remote.health || {}), ...(local.health || {}), metrics:{ ...(remote.health?.metrics || {}), ...(local.health?.metrics || {}) } } })
    );
    merged.deletedWorkoutLog = mergeByKey(remoteState?.deletedWorkoutLog, localState?.deletedWorkoutLog, item => item?.id || item?.log?.id || JSON.stringify(item));
    merged.weightLog = mergeByKey(remoteState?.weightLog, localState?.weightLog, item => item?.date || JSON.stringify(item));
    merged.settings = { ...(remoteState?.settings || {}), ...(localState?.settings || {}) };
    return typeof normalizeState === 'function' ? normalizeState(merged) : merged;
  }

  async function logCloudError(code, error, context = {}){
    console.error(`[GymLog ${code}]`, error);
    if(!gymLogCloudClient || !gymLogCloudSession) return;
    try{
      await gymLogCloudClient.from('gymlog_sync_events').insert({
        user_id:gymLogCloudSession.user.id,
        level:'error', code,
        message:String(error?.message || error || '').slice(0, 500),
        context
      });
    }catch(logError){
      console.warn('No se pudo registrar el error de sincronización.', logError);
    }
  }

  const baseSave = save;
  save = function(){
    recordPendingState();
    return baseSave.apply(this, arguments);
  };

  loadUserCloudState = async function(){
    if(!gymLogCloudClient || !gymLogCloudSession) return;
    setCloudStatus('pending', 'Nube: cargando');
    try{
      const { data, error } = await gymLogCloudClient
        .from('gymlog_user_state')
        .select('data,revision,updated_at')
        .eq('user_id', gymLogCloudSession.user.id)
        .maybeSingle();
      if(error) throw error;

      const pending = readPendingState();
      if(data?.data){
        cloudRevision = Number(data.revision) || 1;
        cloudUpdatedAt = data.updated_at || null;
        if(pending?.state){
          preserveRecoveryState('remote-before-merge', data.data);
          state = pending.revision === cloudRevision ? clone(pending.state) : mergeStates(data.data, pending.state);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          refreshCloudUi();
          setCloudStatus('pending', 'Nube: recuperando cambios');
          await saveUserCloudState({ immediate:true });
          showToast('Cambios locales recuperados y sincronizados');
          return;
        }
        state = { ...state, ...data.data };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        refreshCloudUi();
        setCloudStatus('ok', `Nube ✓ r${cloudRevision}`);
        showToast('✓ Datos cargados desde la nube');
      }else{
        cloudRevision = 0;
        recordPendingState();
        await saveUserCloudState({ immediate:true });
      }
    }catch(error){
      setCloudStatus('error', 'Nube: error al cargar');
      await logCloudError('cloud_load_failed', error);
      showToast('Tus datos locales siguen seguros; falló la carga de nube');
    }
  };

  async function resolveCloudConflict(localSnapshot, savedSequence){
    const { data:remote, error } = await gymLogCloudClient
      .from('gymlog_user_state')
      .select('data,revision,updated_at')
      .eq('user_id', gymLogCloudSession.user.id)
      .single();
    if(error) throw error;
    preserveRecoveryState('local-conflict', localSnapshot);
    preserveRecoveryState('remote-conflict', remote.data);
    const merged = mergeStates(remote.data, localSnapshot);
    const { data:result, error:saveError } = await gymLogCloudClient.rpc('gymlog_save_user_state', {
      p_data:merged,
      p_expected_revision:Number(remote.revision) || 0,
      p_client_id:clientId,
      p_snapshot_reason:'automatic-conflict-merge'
    });
    if(saveError) throw saveError;
    if(result?.status !== 'saved') throw new Error('La nube cambió de nuevo durante la combinación. Se conservó una copia local.');
    state = merged;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    cloudRevision = Number(result.revision) || Number(remote.revision) + 1;
    cloudUpdatedAt = result.updatedAt || new Date().toISOString();
    const pending = readPendingState();
    if(!pending || pending.sequence <= savedSequence) localStorage.removeItem(PENDING_STATE_KEY);
    refreshCloudUi();
    setCloudStatus('ok', `Nube ✓ r${cloudRevision}`);
    showToast('Cambios de dos dispositivos combinados sin perder sesiones');
  }

  async function performCloudSave(options = {}){
    if(!gymLogCloudClient || !gymLogCloudSession) return false;
    const localSnapshot = clone(state);
    const pending = readPendingState();
    const savedSequence = pending?.sequence || localSequence;
    setCloudStatus('pending', 'Nube: guardando…');
    const snapshotReason = options.snapshotReason || nextSnapshotReason;
    nextSnapshotReason = null;
    try{
      const { data:result, error } = await gymLogCloudClient.rpc('gymlog_save_user_state', {
        p_data:localSnapshot,
        p_expected_revision:cloudRevision,
        p_client_id:clientId,
        p_snapshot_reason:snapshotReason || null
      });
      if(error) throw error;
      if(result?.status === 'conflict'){
        setCloudStatus('warning', 'Nube: combinando cambios');
        await resolveCloudConflict(localSnapshot, savedSequence);
        return true;
      }
      if(result?.status !== 'saved') throw new Error('Supabase no confirmó el guardado.');
      cloudRevision = Number(result.revision) || cloudRevision + 1;
      cloudUpdatedAt = result.updatedAt || new Date().toISOString();
      const latestPending = readPendingState();
      if(!latestPending || latestPending.sequence <= savedSequence) localStorage.removeItem(PENDING_STATE_KEY);
      setCloudStatus('ok', `Nube ✓ r${cloudRevision}`);
      return true;
    }catch(error){
      setCloudStatus('error', 'Nube: pendiente local');
      await logCloudError('cloud_save_failed', error, { revision:cloudRevision });
      if(!options.silent) showToast('Guardado local seguro; la nube se reintentará');
      return false;
    }
  }

  saveUserCloudState = function(options = {}){
    if(cloudSaveInFlight){
      cloudSaveQueued = true;
      return cloudSaveInFlight;
    }
    cloudSaveInFlight = performCloudSave(options).finally(() => {
      cloudSaveInFlight = null;
      if(cloudSaveQueued){
        cloudSaveQueued = false;
        queueMicrotask(() => saveUserCloudState({ silent:true }));
      }
    });
    return cloudSaveInFlight;
  };

  const baseHealthRequest = healthFunctionRequest;
  healthFunctionRequest = async function(action, payload = {}){
    if(action === 'backup' && (payload?.reason === 'pre-restore' || payload?.backupMeta?.reason === 'pre-restore')){
      nextSnapshotReason = 'pre-drive-restore';
    }
    return baseHealthRequest(action, payload);
  };

  const baseFinishWorkout = typeof finishWorkout === 'function' ? finishWorkout : null;
  if(baseFinishWorkout){
    finishWorkout = function(){
      const result = baseFinishWorkout.apply(this, arguments);
      Promise.resolve(result).finally(() => saveUserCloudState({ immediate:true, silent:true }));
      return result;
    };
  }

  function profile(){
    state.settings = state.settings || {};
    state.settings.healthProfile = state.settings.healthProfile || {};
    return state.settings.healthProfile;
  }

  function zoneInfo(bpm){
    const data = profile();
    const max = Number(data.maxHeartRate);
    const resting = Number(data.restingHeartRate);
    if(!Number.isFinite(max) || max < 100) return null;
    const intensity = Number.isFinite(resting) && resting >= 30 && resting < max
      ? (bpm - resting) / (max - resting)
      : bpm / max;
    const boundaries = Array.isArray(data.zoneBoundaries) && data.zoneBoundaries.length === 4
      ? data.zoneBoundaries.map(Number)
      : [0.6, 0.7, 0.8, 0.9];
    const index = intensity < boundaries[0] ? 0 : intensity < boundaries[1] ? 1 : intensity < boundaries[2] ? 2 : intensity < boundaries[3] ? 3 : 4;
    return { index, name:`Z${index + 1}`, intensity };
  }

  function heartValues(log){
    return (healthForLog(log).metrics?.heartRateSamples || [])
      .map(sample => Number(sample.bpm ?? sample.value ?? sample.heartRate))
      .filter(value => Number.isFinite(value) && value >= 40 && value <= 240);
  }

  function zoneDurations(log){
    const values = heartValues(log);
    if(!values.length || !zoneInfo(values[0])) return null;
    const duration = Math.max(0, Number(log.duration) || 0);
    const secondsPerSample = duration && values.length ? duration / values.length : 0;
    const seconds = [0,0,0,0,0];
    values.forEach(value => { seconds[zoneInfo(value).index] += secondsPerSample; });
    return seconds;
  }

  function downsample(values, maxPoints = 600){
    if(values.length <= maxPoints) return values.map((value, index) => ({ value, index }));
    const bucket = values.length / Math.max(2, Math.floor(maxPoints / 2));
    const output = [{ value:values[0], index:0 }];
    for(let start = 1; start < values.length - 1; start += bucket){
      const from = Math.floor(start);
      const to = Math.min(values.length - 1, Math.floor(start + bucket));
      let minIndex = from, maxIndex = from;
      for(let index = from + 1; index < to; index++){
        if(values[index] < values[minIndex]) minIndex = index;
        if(values[index] > values[maxIndex]) maxIndex = index;
      }
      [minIndex, maxIndex].sort((a,b) => a-b).forEach(index => output.push({ value:values[index], index }));
    }
    output.push({ value:values.at(-1), index:values.length - 1 });
    return output;
  }

  function ensureHeartRateModal(){
    if(document.getElementById('heartRateDetailOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'heartRateDetailOverlay';
    overlay.className = 'gym-hr-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'heartRateDetailTitle');
    overlay.innerHTML = `<div class="gym-hr-dialog"><div class="gym-hr-head"><div><strong id="heartRateDetailTitle">Frecuencia cardiaca</strong><div id="heartRateDetailSubtitle" class="gym-hr-subtitle"></div></div><button type="button" class="ghost-btn" id="heartRateDetailClose">Cerrar</button></div><div class="gym-hr-canvas-wrap"><canvas id="heartRateDetailCanvas" aria-label="Gráfica detallada de frecuencia cardiaca"></canvas><div id="heartRateTooltip" class="gym-hr-tooltip"></div></div><div id="heartRateDetailStats" class="gym-hr-stats"></div><div id="heartRateDetailQuality" class="progress-note"></div></div>`;
    overlay.addEventListener('click', event => { if(event.target === overlay) closeHeartRateDetails(); });
    document.body.appendChild(overlay);
    document.getElementById('heartRateDetailClose').addEventListener('click', closeHeartRateDetails);
  }

  function drawDetailedHeartRate(log){
    const values = heartValues(log);
    const canvas = document.getElementById('heartRateDetailCanvas');
    if(!canvas || !values.length) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(300, Math.round(rect.width || 640));
    const height = Math.max(260, Math.round(rect.height || 320));
    canvas.width = width * dpr; canvas.height = height * dpr;
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
    const left=44,right=12,top=18,bottom=38, chartW=width-left-right, chartH=height-top-bottom;
    const min=Math.max(40,Math.floor(Math.min(...values)/10)*10-10);
    const max=Math.min(240,Math.ceil(Math.max(...values)/10)*10+10);
    const range=max-min || 1;
    const styles=getComputedStyle(document.documentElement);
    const muted=styles.getPropertyValue('--muted').trim()||'#9ca3af';
    const border=styles.getPropertyValue('--border').trim()||'rgba(255,255,255,.15)';
    const colors=['#60a5fa','#34d399','#facc15','#fb923c','#ef4444'];
    ctx.clearRect(0,0,width,height); ctx.font='12px DM Sans, sans-serif';
    for(let i=0;i<=4;i++){
      const value=min+(range*i/4), y=top+chartH-(chartH*i/4);
      ctx.strokeStyle=border; ctx.beginPath(); ctx.moveTo(left,y); ctx.lineTo(width-right,y); ctx.stroke();
      ctx.fillStyle=muted; ctx.fillText(String(Math.round(value)),4,y+4);
    }
    const points=downsample(values, Math.min(800, Math.max(250, width*1.5)));
    const x=index=>left+(index/(values.length-1||1))*chartW;
    const y=value=>top+chartH-((value-min)/range)*chartH;
    ctx.lineWidth=2; ctx.beginPath();
    points.forEach((point,index)=>{ const px=x(point.index),py=y(point.value); index?ctx.lineTo(px,py):ctx.moveTo(px,py); });
    ctx.strokeStyle=styles.getPropertyValue('--done').trim()||'#34d399'; ctx.stroke();
    points.forEach(point=>{ const zone=zoneInfo(point.value); if(!zone) return; ctx.fillStyle=colors[zone.index]; ctx.fillRect(x(point.index)-1,y(point.value)-1,2,2); });
    ctx.fillStyle=muted; ctx.textAlign='left'; ctx.fillText('Inicio',left,height-10); ctx.textAlign='right'; ctx.fillText(`${Math.round((Number(log.duration)||0)/60)} min`,width-right,height-10); ctx.textAlign='left';

    const tooltip=document.getElementById('heartRateTooltip');
    const showPoint=clientX=>{
      const bounds=canvas.getBoundingClientRect();
      const px=Math.max(0,Math.min(bounds.width,clientX-bounds.left));
      const index=Math.max(0,Math.min(values.length-1,Math.round(((px-left)/(chartW||1))*values.length)));
      const minute=((Number(log.duration)||0)*(index/(values.length-1||1))/60);
      tooltip.textContent=`${values[index]} bpm · min ${minute.toFixed(1)}${zoneInfo(values[index]) ? ` · ${zoneInfo(values[index]).name}` : ''}`;
      tooltip.style.display='block';
    };
    canvas.onpointermove=event=>showPoint(event.clientX);
    canvas.onpointerleave=()=>{tooltip.style.display='none';};
  }

  window.openHeartRateDetails = function(logId){
    const log = state.workoutLog.find(item => item.id === logId);
    if(!log || !heartValues(log).length) return showToast('Esta sesión aún no tiene lecturas de pulso');
    ensureHeartRateModal();
    const values=heartValues(log), zones=zoneDurations(log);
    document.getElementById('heartRateDetailTitle').textContent=log.routineName || 'Frecuencia cardiaca';
    document.getElementById('heartRateDetailSubtitle').textContent=`${log.date || ''} · ${values.length} lecturas`;
    document.getElementById('heartRateDetailStats').innerHTML=`<span>Media <strong>${Math.round(values.reduce((a,b)=>a+b,0)/values.length)} bpm</strong></span><span>Máxima <strong>${Math.max(...values)} bpm</strong></span>${zones ? zones.map((seconds,index)=>`<span>Z${index+1} <strong>${Math.round(seconds/60)} min</strong></span>`).join('') : '<span>Configura tu FC máxima para calcular zonas</span>'}`;
    const missingTimes=(healthForLog(log).metrics?.heartRateSamples||[]).filter(sample=>!sample.time).length;
    document.getElementById('heartRateDetailQuality').textContent=missingTimes
      ? `Calidad: ${values.length} BPM válidos; Fitbit no entregó hora por muestra. El eje reparte las lecturas durante la duración registrada, sin inventar horas.`
      : `Calidad: ${values.length} lecturas con marca temporal. Zona horaria: ${profile().timezone || 'Europe/Madrid'}.`;
    document.getElementById('heartRateDetailOverlay').classList.add('open');
    requestAnimationFrame(()=>drawDetailedHeartRate(log));
  };

  window.closeHeartRateDetails = function(){
    document.getElementById('heartRateDetailOverlay')?.classList.remove('open');
  };

  const baseHealthSessionHtml = healthSessionHtml;
  healthSessionHtml = function(log){
    const html=baseHealthSessionHtml(log);
    if(!heartValues(log).length) return html;
    return html.replace('</div></div>', `<button class="health-mini-btn" onclick="openHeartRateDetails('${escapeAttribute(log.id)}')">Ver gráfica completa</button></div></div>`);
  };

  function volumeForLog(log){
    return (log.exercises || []).reduce((total,exercise)=>total+(exercise.series||[]).reduce((sum,set)=>sum+((set.done === false ? 0 : 1)*(Number(set.reps)||0)*(Number(set.weight)||0)),0),0);
  }

  function pearson(pairs){
    if(pairs.length < 3) return null;
    const xs=pairs.map(item=>item[0]),ys=pairs.map(item=>item[1]);
    const mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length;
    const top=pairs.reduce((sum,[x,y])=>sum+(x-mx)*(y-my),0);
    const bottom=Math.sqrt(xs.reduce((sum,x)=>sum+(x-mx)**2,0)*ys.reduce((sum,y)=>sum+(y-my)**2,0));
    return bottom ? top/bottom : null;
  }

  function correlationHtml(logs){
    const withHr=logs.map(log=>({log,avg:Number(healthForLog(log).metrics?.averageHeartRate)})).filter(item=>Number.isFinite(item.avg)&&item.avg>=40);
    const volume=pearson(withHr.map(item=>[volumeForLog(item.log),item.avg]).filter(item=>item[0]>0));
    const duration=pearson(withHr.map(item=>[(Number(item.log.duration)||0)/60,item.avg]).filter(item=>item[0]>0));
    const rpe=pearson(withHr.map(item=>[Number(item.log.rpe ?? item.log.effort),item.avg]).filter(item=>Number.isFinite(item[0])));
    const label=value=>value===null?'Datos insuficientes':`${value>=0?'+':''}${value.toFixed(2)}`;
    return `<div class="gym-health-analysis"><div class="chart-title">Relación con el entrenamiento</div><div class="gym-analysis-grid"><span>Volumen ↔ FC media<strong>${label(volume)}</strong></span><span>Duración ↔ FC media<strong>${label(duration)}</strong></span><span>RPE ↔ FC media<strong>${label(rpe)}</strong></span></div><div class="progress-note">Correlación descriptiva de tus sesiones (−1 a +1); no implica causalidad. Se necesitan al menos 3 sesiones comparables.</div></div>`;
  }

  const baseRenderHeartRatePanel = renderProgressHeartRatePanel;
  renderProgressHeartRatePanel = function(logs){
    baseRenderHeartRatePanel(logs);
    const panel=document.getElementById('progressInfoPanel');
    if(!panel) return;
    const totalSamples=logs.reduce((sum,log)=>sum+heartValues(log).length,0);
    const withHr=logs.filter(log=>heartValues(log).length).length;
    const synced=logs.filter(log=>healthForLog(log).syncStatus==='synced').length;
    panel.insertAdjacentHTML('beforeend', `<div class="gym-health-analysis"><div class="chart-title">Cobertura Health / Fitbit</div><div class="gym-analysis-grid"><span>Sesiones del periodo<strong>${logs.length}</strong></span><span>Google Health<strong>${synced}</strong></span><span>Con pulso<strong>${withHr}</strong></span><span>Lecturas<strong>${totalSamples.toLocaleString('es-ES')}</strong></span></div></div>${correlationHtml(logs)}`);
  };

  function profilePanel(){
    const data=profile();
    return `<div class="gym-health-profile" id="gymHealthProfile"><div class="chart-title">Perfil de frecuencia cardiaca</div><div class="gym-profile-grid"><label>Edad (opcional)<input id="gymHealthAge" type="number" min="12" max="100" value="${escapeAttribute(data.age || '')}"></label><label>FC máxima<input id="gymHealthMax" type="number" min="100" max="240" value="${escapeAttribute(data.maxHeartRate || '')}" placeholder="Sin configurar"></label><label>FC en reposo<input id="gymHealthRest" type="number" min="30" max="120" value="${escapeAttribute(data.restingHeartRate || '')}" placeholder="Opcional"></label><label>Zona horaria<input id="gymHealthTimezone" value="${escapeAttribute(data.timezone || 'Europe/Madrid')}"></label></div><div class="health-actions"><button class="ghost-btn" type="button" onclick="saveGymHealthProfile()">Guardar perfil</button><button class="ghost-btn" type="button" onclick="estimateGymMaxHeartRate()">Estimar FC máx. por edad</button></div><div class="progress-note">Las zonas usan 60/70/80/90 % de FC máxima, o reserva cardiaca si añades FC en reposo. La estimación por edad es orientativa y solo se aplica si tú pulsas el botón.</div></div>`;
  }

  window.estimateGymMaxHeartRate = function(){
    const age=Number(document.getElementById('gymHealthAge')?.value);
    if(!Number.isFinite(age)||age<12||age>100) return showToast('Introduce una edad válida');
    document.getElementById('gymHealthMax').value=String(Math.round(208-(0.7*age)));
    showToast('Estimación aplicada; revisa y guarda si te sirve');
  };

  window.saveGymHealthProfile = async function(){
    const age=Number(document.getElementById('gymHealthAge')?.value)||null;
    const max=Number(document.getElementById('gymHealthMax')?.value)||null;
    const resting=Number(document.getElementById('gymHealthRest')?.value)||null;
    const timezone=document.getElementById('gymHealthTimezone')?.value?.trim()||'Europe/Madrid';
    if(max && (max<100||max>240)) return showToast('La FC máxima debe estar entre 100 y 240');
    if(resting && (resting<30||resting>120)) return showToast('La FC en reposo debe estar entre 30 y 120');
    state.settings.healthProfile={ age, maxHeartRate:max, restingHeartRate:resting, timezone, zoneBoundaries:[0.6,0.7,0.8,0.9] };
    save();
    if(gymLogCloudClient&&gymLogCloudSession){
      const { error }=await gymLogCloudClient.from('gymlog_user_preferences').upsert({ user_id:gymLogCloudSession.user.id, age, max_heart_rate:max, resting_heart_rate:resting, heart_rate_zones:{boundaries:[0.6,0.7,0.8,0.9]}, timezone, updated_at:new Date().toISOString() });
      if(error){ await logCloudError('health_profile_save_failed',error); return showToast('Perfil guardado localmente; falló la nube'); }
    }
    showToast('Perfil de frecuencia cardiaca guardado');
    renderHealthSettings();
  };

  async function loadHealthProfile(){
    if(!gymLogCloudClient||!gymLogCloudSession) return;
    const { data,error }=await gymLogCloudClient.from('gymlog_user_preferences').select('*').eq('user_id',gymLogCloudSession.user.id).maybeSingle();
    if(error||!data) return;
    state.settings=state.settings||{};
    state.settings.healthProfile={
      ...(state.settings.healthProfile||{}), age:data.age || null,
      maxHeartRate:data.max_heart_rate || null, restingHeartRate:data.resting_heart_rate || null,
      zoneBoundaries:data.heart_rate_zones?.boundaries || [0.6,0.7,0.8,0.9], timezone:data.timezone || 'Europe/Madrid'
    };
  }

  const baseRenderHealthSettings = renderHealthSettings;
  renderHealthSettings = function(){
    baseRenderHealthSettings();
    const signedIn=document.getElementById('healthSignedInPanel');
    if(signedIn && !document.getElementById('gymHealthProfile')) signedIn.insertAdjacentHTML('beforeend',profilePanel());
    const grid=document.getElementById('securityStatusGrid');
    if(grid && !document.getElementById('gymCloudSecurityItem')){
      grid.insertAdjacentHTML('beforeend', `<div class="security-item" id="gymCloudSecurityItem"><div class="security-label">Nube privada</div><div class="security-value ${cloudRevision?'ok':'warn'}">${cloudRevision?`Revisión ${cloudRevision}`:'Cargando'}</div></div><div class="security-item"><div class="security-label">Última nube</div><div class="security-value ${cloudUpdatedAt?'ok':'warn'}">${cloudUpdatedAt?escapeHtml(formatBackupDate(cloudUpdatedAt)):'Pendiente'}</div></div>`);
    }
  };

  async function enqueueHealthRecovery(log){
    if(!gymLogCloudClient||!gymLogCloudSession||!needsFitbitRecovery(log)) return;
    const now=Date.now(), delays=[15*60*1000,2*60*60*1000,24*60*60*1000];
    const rows=delays.map((delay,index)=>({ user_id:gymLogCloudSession.user.id, session_local_id:log.id, attempt:index+1, due_at:new Date(now+delay).toISOString(), status:'pending', updated_at:new Date().toISOString() }));
    const { error }=await gymLogCloudClient.from('gymlog_health_recovery_queue').upsert(rows,{onConflict:'user_id,session_local_id,attempt'});
    if(error) await logCloudError('health_recovery_enqueue_failed',error,{sessionId:log.id});
  }

  const baseSyncWorkoutToHealth = syncWorkoutToHealth;
  syncWorkoutToHealth = async function(logId, options = {}){
    const result=await baseSyncWorkoutToHealth(logId,options);
    const log=state.workoutLog.find(item=>item.id===logId);
    if(log && !recoveryRunning){
      if(needsFitbitRecovery(log)) await enqueueHealthRecovery(log);
      else if(gymLogCloudClient&&gymLogCloudSession) await gymLogCloudClient.from('gymlog_health_recovery_queue').update({status:'done',updated_at:new Date().toISOString()}).eq('user_id',gymLogCloudSession.user.id).eq('session_local_id',logId).in('status',['pending','running']);
    }
    await saveUserCloudState({ immediate:true, silent:true });
    return result;
  };

  async function processHealthRecoveryQueue(){
    if(recoveryRunning||gymLogHealthBusy||!navigator.onLine||!gymLogCloudClient||!gymLogCloudSession||!gymLogGoogleConnected) return;
    recoveryRunning=true;
    try{
      const { data:rows,error }=await gymLogCloudClient.from('gymlog_health_recovery_queue').select('*').eq('user_id',gymLogCloudSession.user.id).eq('status','pending').lte('due_at',new Date().toISOString()).order('due_at').limit(1);
      if(error) throw error;
      const row=rows?.[0]; if(!row) return;
      const log=state.workoutLog.find(item=>item.id===row.session_local_id);
      if(!log){
        await gymLogCloudClient.from('gymlog_health_recovery_queue').update({status:'cancelled',last_error:'session_not_found',updated_at:new Date().toISOString()}).eq('user_id',row.user_id).eq('session_local_id',row.session_local_id).eq('attempt',row.attempt);
        return;
      }
      await gymLogCloudClient.from('gymlog_health_recovery_queue').update({status:'running',updated_at:new Date().toISOString()}).eq('user_id',row.user_id).eq('session_local_id',row.session_local_id).eq('attempt',row.attempt);
      const ok=await baseSyncWorkoutToHealth(log.id,{silent:true});
      await gymLogCloudClient.from('gymlog_health_recovery_queue').update({status:ok?'done':'failed',last_error:ok?null:(healthForLog(log).error||'retry_failed'),updated_at:new Date().toISOString()}).eq('user_id',row.user_id).eq('session_local_id',row.session_local_id).eq('attempt',row.attempt);
      if(ok&&hasFitbitData(log)) await gymLogCloudClient.from('gymlog_health_recovery_queue').update({status:'cancelled',updated_at:new Date().toISOString()}).eq('user_id',row.user_id).eq('session_local_id',row.session_local_id).eq('status','pending');
      await saveUserCloudState({immediate:true,silent:true});
    }catch(error){
      await logCloudError('health_recovery_failed',error);
    }finally{
      recoveryRunning=false;
    }
  }

  function appendNoteCatalogControls(){
    const container=document.getElementById('notesSections');
    if(!container||!window.GYMLOG_NOTE_TEMPLATE_CATALOG) return;
    let toolbar=document.getElementById('gymNoteCatalogToolbar');
    if(!toolbar){
      toolbar=document.createElement('div'); toolbar.id='gymNoteCatalogToolbar'; toolbar.className='gym-note-toolbar';
      toolbar.innerHTML='<button type="button" class="ghost-btn" onclick="installClassicNoteCatalog()">Añadir plantilla clásica</button><span>Catálogo opcional: no sustituye tus notas sin confirmación.</span>';
      container.parentElement?.insertBefore(toolbar,container);
    }
    const sections=typeof getNotesSections==='function'?getNotesSections():[];
    container.querySelectorAll('.notes-section-card').forEach((card,index)=>{
      const section=sections[index]; if(!section?.routineId||card.querySelector('.gym-note-start')) return;
      const button=document.createElement('button'); button.type='button'; button.className='ghost-btn gym-note-start'; button.textContent='Empezar rutina';
      button.addEventListener('click',()=>startRoutineFromNotes(section.routineId));
      card.querySelector('.notes-section-actions')?.appendChild(button);
    });
  }

  window.installClassicNoteCatalog = function(){
    const catalog=window.GYMLOG_NOTE_TEMPLATE_CATALOG;
    if(!catalog) return;
    const current=typeof getNotesSections==='function'?getNotesSections():[];
    const existing=new Set(current.map(item=>item.key));
    const additions=catalog.sections.filter(item=>!existing.has(item.key)).map(clone);
    if(!additions.length) return showToast('La plantilla clásica ya está añadida');
    if(!confirm(`Se añadirán ${additions.length} notas clásicas. Tus notas actuales no se borrarán. ¿Continuar?`)) return;
    state.settings=state.settings||{};
    state.settings.notesSections=[...current,...additions];
    save(); renderNotes(); showToast('Plantilla clásica añadida');
  };

  const baseRenderNotes = renderNotes;
  renderNotes = function(){
    baseRenderNotes();
    appendNoteCatalogControls();
  };

  function showUpdatePrompt(registration){
    if(document.getElementById('gymUpdatePrompt')) return;
    const prompt=document.createElement('div'); prompt.id='gymUpdatePrompt'; prompt.className='gym-update-prompt';
    prompt.innerHTML='<span>Nueva versión lista</span><button type="button">Actualizar</button><button type="button" aria-label="Cerrar">×</button>';
    const buttons=prompt.querySelectorAll('button');
    buttons[0].addEventListener('click',()=>{ registration.waiting?.postMessage({type:'SKIP_WAITING'}); });
    buttons[1].addEventListener('click',()=>prompt.remove());
    document.body.appendChild(prompt);
  }

  async function registerPwa(){
    if(!('serviceWorker' in navigator)||!/^https?:$/.test(location.protocol)) return;
    try{
      const registration=await navigator.serviceWorker.register('/service-worker.js');
      if(registration.waiting) showUpdatePrompt(registration);
      registration.addEventListener('updatefound',()=>{
        const worker=registration.installing;
        worker?.addEventListener('statechange',()=>{ if(worker.state==='installed'&&navigator.serviceWorker.controller) showUpdatePrompt(registration); });
      });
      navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload());
    }catch(error){ console.warn('PWA no disponible.',error); }
  }

  function installStyles(){
    if(document.getElementById('gymReliabilityStyles')) return;
    const style=document.createElement('style'); style.id='gymReliabilityStyles';
    style.textContent=`
      .gym-cloud-status{position:fixed;right:12px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:92;border:1px solid var(--border);border-radius:999px;padding:7px 10px;font:800 11px DM Sans,sans-serif;color:var(--text);background:color-mix(in srgb,var(--bg) 88%,transparent);box-shadow:0 6px 20px rgba(0,0,0,.28);backdrop-filter:blur(14px)}
      .gym-cloud-status.ok{color:var(--done)}.gym-cloud-status.pending,.gym-cloud-status.warning{color:var(--accent2)}.gym-cloud-status.error{color:#fca5a5}
      .gym-hr-overlay{display:none;position:fixed;inset:0;z-index:10020;background:rgba(0,0,0,.72);padding:16px;overflow:auto}.gym-hr-overlay.open{display:flex;align-items:center;justify-content:center}
      .gym-hr-dialog{width:min(760px,100%);max-height:92vh;overflow:auto;background:var(--bg);border:1px solid var(--border);border-radius:20px;padding:16px;box-shadow:0 28px 70px rgba(0,0,0,.55)}
      .gym-hr-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.gym-hr-subtitle{color:var(--muted);font-size:12px;margin-top:3px}
      .gym-hr-canvas-wrap{position:relative}.gym-hr-canvas-wrap canvas{width:100%;height:320px;display:block;touch-action:pan-y}.gym-hr-tooltip{display:none;position:absolute;left:50%;top:8px;transform:translateX(-50%);background:var(--surface);border:1px solid var(--border);padding:7px 10px;border-radius:999px;font-size:11px;font-weight:800;pointer-events:none}
      .gym-hr-stats,.gym-analysis-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.gym-hr-stats span,.gym-analysis-grid span{border:1px solid var(--border);background:var(--surface);border-radius:12px;padding:10px;color:var(--muted);font-size:11px}.gym-hr-stats strong,.gym-analysis-grid strong{display:block;color:var(--text);font-size:15px;margin-top:3px}
      .gym-health-analysis,.gym-health-profile{margin-top:12px;padding:14px;border:1px solid var(--border);border-radius:16px;background:var(--card)}.gym-profile-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.gym-profile-grid label{font-size:11px;color:var(--muted);font-weight:800}.gym-profile-grid input{width:100%;margin-top:5px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:9px;box-sizing:border-box}
      .gym-note-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}.gym-note-toolbar span{color:var(--muted);font-size:11px}.gym-note-start{margin-left:6px}
      .gym-update-prompt{position:fixed;left:12px;right:12px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:10030;display:flex;align-items:center;gap:10px;background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:10px 12px;box-shadow:0 18px 40px rgba(0,0,0,.45)}.gym-update-prompt span{flex:1;font-weight:800}.gym-update-prompt button{border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:10px;padding:8px 10px;font-weight:800}
      @media(max-width:640px){.gym-hr-stats,.gym-analysis-grid,.gym-profile-grid{grid-template-columns:1fr 1fr}.gym-hr-canvas-wrap canvas{height:270px}.gym-cloud-status{bottom:calc(78px + env(safe-area-inset-bottom,0px))}}
      @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}.gym-cloud-status,.gym-update-prompt{transition:none!important}}
    `;
    document.head.appendChild(style);
  }

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'&&readPendingState()) saveUserCloudState({immediate:true,silent:true});
    if(document.visibilityState==='visible') processHealthRecoveryQueue();
  });
  window.addEventListener('pagehide',()=>{ if(readPendingState()) saveUserCloudState({immediate:true,silent:true}); });
  window.addEventListener('online',()=>{ setCloudStatus('pending','Nube: reconectando'); saveUserCloudState({silent:true}); processHealthRecoveryQueue(); });
  window.addEventListener('offline',()=>setCloudStatus('warning','Offline · guardado local'));
  window.addEventListener('keydown',event=>{ if(event.key==='Escape') closeHeartRateDetails(); });

  async function bootReliability(){
    revealAppContent(); installStyles(); cloudStatusElement(); ensureHeartRateModal(); appendNoteCatalogControls(); await registerPwa();
    setTimeout(async()=>{ await loadHealthProfile(); renderHealthSettings(); processHealthRecoveryQueue(); },2500);
    setInterval(processHealthRecoveryQueue,5*60*1000);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bootReliability,{once:true});
  else bootReliability();
})();
