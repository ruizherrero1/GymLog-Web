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

  let cloudStatusHideTimer = null;

  function cloudStatusElement(){
    let element = document.getElementById('gymCloudStatus');
    if(element) return element;
    element = document.createElement('div');
    element.id = 'gymCloudStatus';
    element.className = 'gym-cloud-status pending visible';
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    element.setAttribute('aria-atomic', 'true');
    element.title = 'Estado de sincronización privada';
    element.textContent = 'Nube: iniciando';
    document.body.appendChild(element);
    return element;
  }

  function setCloudStatus(kind, text){
    const element = cloudStatusElement();
    if(cloudStatusHideTimer){
      clearTimeout(cloudStatusHideTimer);
      cloudStatusHideTimer = null;
    }
    element.className = `gym-cloud-status ${kind} visible`;
    element.textContent = text;
    const hideAfter = kind === 'ok' ? 2200 : (kind === 'pending' ? 0 : 7000);
    if(hideAfter){
      cloudStatusHideTimer = setTimeout(() => {
        element.classList.remove('visible');
        cloudStatusHideTimer = null;
      }, hideAfter);
    }
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
    const remotePlanVersion = Number(remoteState?.settings?.routinePlanVersion) || 0;
    const localPlanVersion = Number(localState?.settings?.routinePlanVersion) || 0;
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
    if(remotePlanVersion !== localPlanVersion){
      const authoritative = remotePlanVersion > localPlanVersion ? remoteState : localState;
      const planVersion = Math.max(remotePlanVersion,localPlanVersion);
      merged.routines = clone(authoritative?.routines || []);
      merged.settings.routinePlanVersion = planVersion;
      merged.settings.notesSections = clone(authoritative?.settings?.notesSections || []);
      merged.settings.notesText = authoritative?.settings?.notesText || '';
    }
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

  const DEFAULT_MANUAL_REST_SECONDS = 60;
  const MIN_MANUAL_REST_SECONDS = 15;
  const MAX_MANUAL_REST_SECONDS = 600;
  let manualRestEndsAt = 0;
  let manualRestInterval = null;
  let lastWorkoutAction = null;

  function rememberWorkoutAction(label){
    if(!currentRoutineId || !workoutData) return;
    lastWorkoutAction = { routineId:currentRoutineId, workoutData:clone(workoutData), label };
  }
  function clearWorkoutAction(){ lastWorkoutAction = null; }
  function undoGymWorkoutAction(){
    if(!lastWorkoutAction || lastWorkoutAction.routineId !== currentRoutineId){
      clearWorkoutAction(); updateWorkoutToolsUi(); return;
    }
    const label = lastWorkoutAction.label;
    workoutData = clone(lastWorkoutAction.workoutData);
    clearWorkoutAction();
    persistActiveWorkout();
    renderActiveExercises();
    showToast('Deshecho: ' + label);
  }
  window.undoGymWorkoutAction = undoGymWorkoutAction;

  const baseUpdateSeriesQuickReplace = updateSeries;
  updateSeries = function(exId,idx,field,value){
    if(value === null || value === undefined || String(value).trim() === '') return;
    const parsed = field === 'weight' ? parseFloat(value) : parseInt(value,10);
    const next = Number.isFinite(parsed) ? parsed : 0;
    if(workoutData?.[exId]?.series?.[idx]?.[field] !== next){
      rememberWorkoutAction(field === 'weight' ? 'cambio de peso' : 'cambio de repeticiones');
    }
    return baseUpdateSeriesQuickReplace.apply(this,arguments);
  };

  const baseUpdateSeriesTimeUndo = updateSeriesTime;
  updateSeriesTime = function(exId,idx,value){
    const next = parseDurationInput(value);
    if(workoutData?.[exId]?.series?.[idx]?.duration !== next) rememberWorkoutAction('cambio de tiempo');
    return baseUpdateSeriesTimeUndo.apply(this,arguments);
  };
  const baseTickSeriesUndo = tickSeries;
  tickSeries = function(exId,idx){
    if(workoutData?.[exId]?.series?.[idx]) rememberWorkoutAction('marcado de serie');
    return baseTickSeriesUndo.apply(this,arguments);
  };
  const baseToggleAllSeriesUndo = toggleAllSeries;
  toggleAllSeries = function(exId){
    if(workoutData?.[exId]?.series?.length) rememberWorkoutAction('marcado del ejercicio');
    return baseToggleAllSeriesUndo.apply(this,arguments);
  };
  const baseAddSeriesUndo = addSeries;
  addSeries = function(exId){
    if(workoutData?.[exId]) rememberWorkoutAction('serie añadida');
    return baseAddSeriesUndo.apply(this,arguments);
  };

  function isQuickReplaceSeriesInput(target){
    return target instanceof HTMLInputElement
      && target.matches('#phase-active .series-input[type="number"]:not(:disabled)');
  }

  function beginQuickReplaceSeriesInput(input){
    if(input.dataset.quickReplaceActive === 'true') return;
    input.dataset.quickReplaceValue = input.value;
    input.dataset.quickReplacePlaceholder = input.getAttribute('placeholder') || '';
    input.placeholder = input.value;
    input.value = '';
    input.dataset.quickReplaceActive = 'true';
    input.classList.add('quick-replace-active');
  }

  function finishQuickReplaceSeriesInput(input){
    if(input.dataset.quickReplaceActive !== 'true') return;
    if(input.value.trim() === '') input.value = input.dataset.quickReplaceValue || '';
    input.placeholder = input.dataset.quickReplacePlaceholder || '';
    delete input.dataset.quickReplaceValue;
    delete input.dataset.quickReplacePlaceholder;
    delete input.dataset.quickReplaceActive;
    input.classList.remove('quick-replace-active');
  }

  document.addEventListener('focusin',event=>{
    if(isQuickReplaceSeriesInput(event.target)) beginQuickReplaceSeriesInput(event.target);
  });
  document.addEventListener('focusout',event=>{
    if(isQuickReplaceSeriesInput(event.target)) finishQuickReplaceSeriesInput(event.target);
  });
  document.addEventListener('keydown',event=>{
    if(event.key === 'Enter' && isQuickReplaceSeriesInput(event.target)) event.target.blur();
  });
  function restSecondsRemaining(){
    return manualRestEndsAt ? Math.max(0,Math.ceil((manualRestEndsAt-Date.now())/1000)) : 0;
  }
  function configuredRestSeconds(){
    const configured = Number(state?.settings?.manualRestSeconds);
    if(!Number.isFinite(configured)) return DEFAULT_MANUAL_REST_SECONDS;
    return Math.min(MAX_MANUAL_REST_SECONDS,Math.max(MIN_MANUAL_REST_SECONDS,Math.round(configured)));
  }
  function formatRestSeconds(seconds){
    const safe = Math.max(0,Number(seconds)||0);
    return Math.floor(safe/60) + ':' + String(safe%60).padStart(2,'0');
  }
  function updateWorkoutToolsUi(){
    const restButton = document.getElementById('gymManualRestButton');
    const cancelButton = document.getElementById('gymManualRestCancel');
    const undoButton = document.getElementById('gymUndoWorkoutButton');
    const remaining = restSecondsRemaining();
    if(restButton){
      const configured = configuredRestSeconds();
      restButton.textContent = 'Descanso ' + formatRestSeconds(remaining || configured);
      restButton.classList.toggle('running',remaining>0);
      restButton.disabled = remaining>0;
      restButton.setAttribute('aria-label',remaining ? 'Descanso en curso, quedan ' + remaining + ' segundos' : 'Iniciar descanso de ' + configured + ' segundos');
    }
    if(cancelButton) cancelButton.hidden = !remaining;
    if(undoButton){
      const available = !!lastWorkoutAction && lastWorkoutAction.routineId === currentRoutineId;
      undoButton.disabled = !available;
      undoButton.title = available ? 'Deshacer ' + lastWorkoutAction.label : 'No hay acciones para deshacer';
    }
  }
  function finishManualRestTimer(){
    if(manualRestInterval) clearInterval(manualRestInterval);
    manualRestInterval = null;
    manualRestEndsAt = 0;
    updateWorkoutToolsUi();
    if(typeof playTimerBeep === 'function') playTimerBeep();
    showToast('Descanso terminado');
  }
  function tickManualRestTimer(){
    if(!manualRestEndsAt) return;
    if(restSecondsRemaining() <= 0){ finishManualRestTimer(); return; }
    updateWorkoutToolsUi();
  }
  function cancelManualRestTimer(notify = true){
    const wasRunning = !!manualRestEndsAt;
    if(manualRestInterval) clearInterval(manualRestInterval);
    manualRestInterval = null;
    manualRestEndsAt = 0;
    updateWorkoutToolsUi();
    if(wasRunning && notify) showToast('Descanso cancelado');
  }
  function startManualRestTimer(){
    if(!currentRoutineId || manualRestEndsAt) return;
    if(typeof primeAudioContext === 'function') primeAudioContext();
    const duration = configuredRestSeconds();
    manualRestEndsAt = Date.now() + duration*1000;
    if(manualRestInterval) clearInterval(manualRestInterval);
    manualRestInterval = setInterval(tickManualRestTimer,250);
    updateWorkoutToolsUi();
    showToast('Descanso de ' + formatRestSeconds(duration) + ' iniciado');
  }
  window.startManualRestTimer = startManualRestTimer;
  window.cancelManualRestTimer = cancelManualRestTimer;

  const ROUTINE_TIMER_STORAGE_KEY = 'gymlog-routine-timer-v1';
  const DEFAULT_ROUTINE_COUNTDOWN_SECONDS = 30*60;
  let routineTimerState = null;
  let routineTimerInterval = null;

  function routineTimerConfig(routine){
    const mode = routine?.timerMode === 'stopwatch' || routine?.timerMode === 'countdown' ? routine.timerMode : 'none';
    const configured = Math.round(Number(routine?.timerDurationSeconds) || DEFAULT_ROUTINE_COUNTDOWN_SECONDS);
    return { mode, duration:Math.min(6*60*60,Math.max(60,configured)) };
  }
  function initialRoutineTimerState(routineId,config){
    return {
      routineId,
      mode:config.mode,
      duration:config.duration,
      elapsed:0,
      remaining:config.duration,
      startedAt:0,
      running:false,
      finished:false
    };
  }
  function readRoutineTimerState(){
    try{
      const saved = JSON.parse(localStorage.getItem(ROUTINE_TIMER_STORAGE_KEY) || 'null');
      return saved && typeof saved === 'object' ? saved : null;
    }catch{
      return null;
    }
  }
  function persistRoutineTimerState(){
    try{
      if(routineTimerState) localStorage.setItem(ROUTINE_TIMER_STORAGE_KEY,JSON.stringify(routineTimerState));
      else localStorage.removeItem(ROUTINE_TIMER_STORAGE_KEY);
    }catch(error){
      console.warn('No se pudo guardar el temporizador de rutina.',error);
    }
  }
  function clearRoutineTimerInterval(){
    if(routineTimerInterval) clearInterval(routineTimerInterval);
    routineTimerInterval = null;
  }
  function clearRoutineTimerState(){
    clearRoutineTimerInterval();
    routineTimerState = null;
    persistRoutineTimerState();
    document.getElementById('gymRoutineTimerPanel')?.remove();
  }
  function routineTimerValue(now = Date.now()){
    if(!routineTimerState) return 0;
    const delta = routineTimerState.running && routineTimerState.startedAt
      ? Math.max(0,Math.floor((now-routineTimerState.startedAt)/1000))
      : 0;
    return routineTimerState.mode === 'countdown'
      ? Math.max(0,(Number(routineTimerState.remaining)||0)-delta)
      : Math.max(0,(Number(routineTimerState.elapsed)||0)+delta);
  }
  function formatRoutineTimer(seconds){
    const safe = Math.max(0,Math.floor(Number(seconds)||0));
    const hours = Math.floor(safe/3600);
    const minutes = Math.floor((safe%3600)/60);
    const secs = safe%60;
    return hours
      ? String(hours).padStart(2,'0') + ':' + String(minutes).padStart(2,'0') + ':' + String(secs).padStart(2,'0')
      : String(minutes).padStart(2,'0') + ':' + String(secs).padStart(2,'0');
  }
  function settleRoutineTimer(){
    if(!routineTimerState?.running) return;
    const value = routineTimerValue();
    if(routineTimerState.mode === 'countdown') routineTimerState.remaining = value;
    else routineTimerState.elapsed = value;
    routineTimerState.running = false;
    routineTimerState.startedAt = 0;
  }
  function ensureRoutineTimerState(forceReset = false){
    const routine = state.routines.find(item=>item.id===currentRoutineId);
    const config = routineTimerConfig(routine);
    if(!routine || config.mode === 'none'){
      clearRoutineTimerState();
      return null;
    }
    if(!forceReset && routineTimerState?.routineId === routine.id && routineTimerState.mode === config.mode){
      return routineTimerState;
    }
    const saved = !forceReset ? readRoutineTimerState() : null;
    if(saved?.routineId === routine.id && saved.mode === config.mode){
      routineTimerState = {
        ...initialRoutineTimerState(routine.id,config),
        ...saved,
        duration:config.duration
      };
      if(config.mode === 'countdown'){
        routineTimerState.remaining = Math.min(config.duration,Math.max(0,Number(routineTimerState.remaining)||0));
      }
    }else{
      routineTimerState = initialRoutineTimerState(routine.id,config);
      persistRoutineTimerState();
    }
    return routineTimerState;
  }
  function updateRoutineTimerPanel(){
    const panel = document.getElementById('gymRoutineTimerPanel');
    if(!panel || !routineTimerState) return;
    const value = routineTimerValue();
    const timerValue = panel.querySelector('#gymRoutineTimerValue');
    const status = panel.querySelector('#gymRoutineTimerStatus');
    const toggle = panel.querySelector('#gymRoutineTimerToggle');
    if(timerValue) timerValue.textContent = formatRoutineTimer(value);
    panel.classList.toggle('running',!!routineTimerState.running);
    panel.classList.toggle('finished',!!routineTimerState.finished);
    if(status){
      status.textContent = routineTimerState.finished
        ? 'Tiempo terminado'
        : routineTimerState.running
          ? 'En marcha'
          : (value === (routineTimerState.mode === 'countdown' ? routineTimerState.duration : 0) ? 'Listo' : 'Parado');
    }
    if(toggle){
      toggle.textContent = routineTimerState.running ? '■ Parar' : (routineTimerState.finished ? '▶ Repetir' : '▶ Play');
      toggle.setAttribute('aria-label',routineTimerState.running ? 'Parar temporizador de rutina' : 'Iniciar temporizador de rutina');
    }
  }
  function finishRoutineCountdown(){
    if(!routineTimerState || routineTimerState.mode !== 'countdown' || routineTimerState.finished) return;
    routineTimerState.remaining = 0;
    routineTimerState.startedAt = 0;
    routineTimerState.running = false;
    routineTimerState.finished = true;
    clearRoutineTimerInterval();
    persistRoutineTimerState();
    updateRoutineTimerPanel();
    if(typeof playTimerBeep === 'function') playTimerBeep();
    if(typeof navigator.vibrate === 'function') navigator.vibrate([180,90,180]);
    showToast('Cuenta atrás terminada');
  }
  function tickRoutineTimer(){
    if(!routineTimerState?.running) return;
    if(routineTimerState.mode === 'countdown' && routineTimerValue() <= 0){
      finishRoutineCountdown();
      return;
    }
    updateRoutineTimerPanel();
  }
  function startRoutineTimerInterval(){
    clearRoutineTimerInterval();
    routineTimerInterval = setInterval(tickRoutineTimer,250);
  }
  function toggleRoutineTimer(){
    if(!ensureRoutineTimerState()) return;
    if(routineTimerState.running){
      settleRoutineTimer();
      clearRoutineTimerInterval();
      persistRoutineTimerState();
      updateRoutineTimerPanel();
      return;
    }
    if(routineTimerState.mode === 'countdown' && (routineTimerState.finished || routineTimerState.remaining <= 0)){
      routineTimerState.remaining = routineTimerState.duration;
      routineTimerState.finished = false;
    }
    if(typeof primeAudioContext === 'function') primeAudioContext();
    routineTimerState.startedAt = Date.now();
    routineTimerState.running = true;
    routineTimerState.finished = false;
    persistRoutineTimerState();
    startRoutineTimerInterval();
    updateRoutineTimerPanel();
  }
  function resetRoutineTimer(){
    const routine = state.routines.find(item=>item.id===currentRoutineId);
    const config = routineTimerConfig(routine);
    if(!routine || config.mode === 'none') return;
    clearRoutineTimerInterval();
    routineTimerState = initialRoutineTimerState(routine.id,config);
    persistRoutineTimerState();
    updateRoutineTimerPanel();
  }
  window.toggleRoutineTimer = toggleRoutineTimer;
  window.resetRoutineTimer = resetRoutineTimer;

  function renderRoutineTimerPanel(){
    const activeExercises = document.getElementById('activeExercises');
    const timer = ensureRoutineTimerState();
    if(!activeExercises || !timer) return;
    let panel = document.getElementById('gymRoutineTimerPanel');
    if(!panel){
      panel = document.createElement('section');
      panel.id = 'gymRoutineTimerPanel';
      panel.className = 'gym-routine-timer';
      panel.setAttribute('aria-label','Temporizador de la rutina');
      panel.innerHTML = '<div class="gym-routine-timer-head"><div><div class="gym-routine-timer-kicker" id="gymRoutineTimerMode"></div><div class="gym-routine-timer-status" id="gymRoutineTimerStatus" aria-live="polite">Listo</div></div><span class="gym-routine-timer-dot"></span></div><div class="gym-routine-timer-value" id="gymRoutineTimerValue">00:00</div><div class="gym-routine-timer-actions"><button type="button" class="primary" id="gymRoutineTimerToggle" onclick="toggleRoutineTimer()">▶ Play</button><button type="button" onclick="resetRoutineTimer()">↺ Reiniciar</button></div><div class="gym-routine-timer-note">Tú decides cuándo empieza. Si sales de la app, seguirá calculando el tiempo correctamente.</div>';
      activeExercises.parentNode.insertBefore(panel,activeExercises);
    }
    const mode = panel.querySelector('#gymRoutineTimerMode');
    if(mode) mode.textContent = timer.mode === 'countdown' ? 'Cuenta atrás de rutina' : 'Cronómetro de rutina';
    if(timer.running) startRoutineTimerInterval();
    tickRoutineTimer();
    updateRoutineTimerPanel();
  }

  function adjustQuickSeries(input,delta){
    const exId = input.dataset.quickExerciseId;
    const idx = Number(input.dataset.quickSeriesIndex);
    const field = input.dataset.quickSeriesField;
    if(!exId || !Number.isInteger(idx) || !field) return;
    const fallback = input.dataset.quickReplaceValue || input.value || '0';
    const current = Number.parseFloat(input.value || fallback) || 0;
    const next = Math.max(0,field === 'reps' ? Math.round(current+delta) : Math.round((current+delta)*10)/10);
    if(next === current) return;
    input.value = String(next);
    updateSeries(exId,idx,field,String(next));
  }
  function quickAdjustButton(input,delta,label){
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gym-series-step ' + (delta<0?'minus':'plus');
    button.textContent = delta<0 ? '−' : '+';
    button.setAttribute('aria-label',label);
    button.addEventListener('pointerdown',event=>event.preventDefault());
    button.addEventListener('click',()=>adjustQuickSeries(input,delta));
    return button;
  }
  function installQuickAdjustControls(){
    document.querySelectorAll('#phase-active .exercise-block[data-exercise-id]').forEach(block=>{
      const exId = block.dataset.exerciseId;
      block.querySelectorAll('.series-row').forEach((row,idx)=>{
        row.querySelectorAll('.series-input[type=number]:not(:disabled)').forEach(input=>{
          if(input.closest('.gym-series-stepper')) return;
          const field = input.getAttribute('placeholder') === 'kg' ? 'weight' : 'reps';
          const delta = field === 'weight' ? 2.5 : 1;
          input.dataset.quickExerciseId = exId;
          input.dataset.quickSeriesIndex = String(idx);
          input.dataset.quickSeriesField = field;
          const wrapper = document.createElement('div');
          wrapper.className = 'gym-series-stepper';
          input.parentNode.insertBefore(wrapper,input);
          wrapper.append(
            quickAdjustButton(input,-delta,field === 'weight' ? 'Restar 2,5 kilos' : 'Restar 1 repetición'),
            input,
            quickAdjustButton(input,delta,field === 'weight' ? 'Sumar 2,5 kilos' : 'Sumar 1 repetición')
          );
        });
      });
    });
  }
  function installWorkoutTools(){
    const dock = document.getElementById('activeQuickActions');
    if(!dock || !currentRoutineId){
      document.body.classList.remove('gym-workout-tools-active');
      return;
    }
    document.body.classList.add('gym-workout-tools-active');
    if(!dock.querySelector('.gym-workout-tools')){
      const tools = document.createElement('div');
      tools.className = 'gym-workout-tools';
      tools.innerHTML = '<div class="gym-rest-control"><button type="button" id="gymManualRestButton" class="gym-workout-tool" onclick="startManualRestTimer()">Descanso 1:00</button><button type="button" id="gymManualRestCancel" class="gym-rest-cancel" aria-label="Cancelar descanso" onclick="cancelManualRestTimer()" hidden>&times;</button></div><button type="button" id="gymUndoWorkoutButton" class="gym-workout-tool undo" onclick="undoGymWorkoutAction()" disabled>&#8630; Deshacer</button>';
      dock.prepend(tools);
    }
    updateWorkoutToolsUi();
  }
  function enhanceActiveWorkoutControls(){
    installQuickAdjustControls();
    installWorkoutTools();
    renderRoutineTimerPanel();
  }
  const baseRenderActiveExercisesMobile = renderActiveExercises;
  renderActiveExercises = function(){
    const result = baseRenderActiveExercisesMobile.apply(this,arguments);
    enhanceActiveWorkoutControls();
    return result;
  };
  const baseStartWorkoutMobile = startWorkout;
  startWorkout = function(){
    cancelManualRestTimer(false);
    clearWorkoutAction();
    clearRoutineTimerState();
    const result = baseStartWorkoutMobile.apply(this,arguments);
    ensureRoutineTimerState(true);
    renderRoutineTimerPanel();
    return result;
  };
  function completeStoppedTimedRoutine(){
    const routine = state.routines.find(item=>item.id===currentRoutineId);
    const completesWorkout = routine?.timerCompletesWorkout || routine?.id === 'cardio-bike-indoor';
    if(!completesWorkout || !routineTimerState || routineTimerState.running || routineTimerValue() <= 0) return false;
    Object.values(workoutData || {}).forEach(exercise => {
      (exercise?.series || []).forEach(series => { series.done = true; });
    });
    if(typeof persistActiveWorkout === 'function') persistActiveWorkout();
    return true;
  }
  const baseFinishWorkoutMobile = finishWorkout;
  finishWorkout = function(){
    completeStoppedTimedRoutine();
    cancelManualRestTimer(false);
    clearWorkoutAction();
    document.body.classList.remove('gym-workout-tools-active');
    const result = baseFinishWorkoutMobile.apply(this,arguments);
    clearRoutineTimerState();
    return result;
  };
  const baseDiscardWorkoutMobile = discardWorkout;
  discardWorkout = function(){
    const previousRoutine = currentRoutineId;
    const result = baseDiscardWorkoutMobile.apply(this,arguments);
    if(previousRoutine && currentRoutineId !== previousRoutine){
      cancelManualRestTimer(false); clearWorkoutAction();
      clearRoutineTimerState();
      document.body.classList.remove('gym-workout-tools-active');
    }
    return result;
  };
  const baseGoToGridMobile = goToGrid;
  goToGrid = function(){
    const previousRoutine = currentRoutineId;
    const result = baseGoToGridMobile.apply(this,arguments);
    if(previousRoutine && currentRoutineId !== previousRoutine){
      cancelManualRestTimer(false); clearWorkoutAction();
      clearRoutineTimerState();
      document.body.classList.remove('gym-workout-tools-active');
    }
    return result;
  };

  function routineTimerBadgeText(routine){
    const config = routineTimerConfig(routine);
    if(config.mode === 'stopwatch') return '⏱ Cronómetro';
    if(config.mode === 'countdown') return '⌛ ' + Math.round(config.duration/60) + ' min';
    return '';
  }
  function decorateRoutineTimerBadges(){
    const routineCards = document.querySelectorAll('#routinesList .rt-block');
    const workoutCards = document.querySelectorAll('#workoutRoutineGrid .routine-card');
    state.routines.forEach((routine,index)=>{
      const text = routineTimerBadgeText(routine);
      if(!text) return;
      const routineBadges = routineCards[index]?.querySelector('.rt-badges');
      if(routineBadges && !routineBadges.querySelector('.gym-routine-timer-badge')){
        routineBadges.insertAdjacentHTML('beforeend','<span class="rt-badge gym-routine-timer-badge">' + escapeHtml(text) + '</span>');
      }
      const workoutBadges = workoutCards[index]?.querySelector('.r-badges');
      if(workoutBadges && !workoutBadges.querySelector('.gym-routine-timer-badge')){
        workoutBadges.insertAdjacentHTML('beforeend','<span class="r-badge gym-routine-timer-badge">' + escapeHtml(text) + '</span>');
      }
    });
  }
  function ensureRoutineTimerEditor(){
    const descriptionField = document.getElementById('rDesc')?.closest('.field');
    if(!descriptionField || document.getElementById('gymRoutineTimerSettings')) return;
    const panel = document.createElement('div');
    panel.id = 'gymRoutineTimerSettings';
    panel.className = 'gym-routine-timer-settings';
    panel.innerHTML = '<div class="gym-routine-timer-settings-title">Temporizador de la rutina</div><div class="gym-routine-timer-settings-copy">Aparecerá dentro del entreno y solo empezará cuando pulses Play.</div><label for="gymRoutineTimerMode">Modo</label><select id="gymRoutineTimerMode"><option value="none">Sin temporizador</option><option value="stopwatch">Cronómetro libre (cuenta hacia arriba)</option><option value="countdown">Cuenta atrás</option></select><div id="gymRoutineTimerDurationField"><label for="gymRoutineTimerMinutes">Duración de la cuenta atrás (minutos)</label><input id="gymRoutineTimerMinutes" type="number" inputmode="numeric" min="1" max="360" step="1" value="30"></div>';
    descriptionField.insertAdjacentElement('afterend',panel);
    panel.querySelector('#gymRoutineTimerMode')?.addEventListener('change',()=>{
      markFormDirty();
      updateRoutineTimerEditorUi();
    });
    panel.querySelector('#gymRoutineTimerMinutes')?.addEventListener('input',()=>markFormDirty());
  }
  function updateRoutineTimerEditorUi(){
    const mode = document.getElementById('gymRoutineTimerMode')?.value || 'none';
    const durationField = document.getElementById('gymRoutineTimerDurationField');
    if(durationField) durationField.hidden = mode !== 'countdown';
  }
  function renderRoutineTimerEditor(routine){
    ensureRoutineTimerEditor();
    const config = routineTimerConfig(routine);
    const mode = document.getElementById('gymRoutineTimerMode');
    const minutes = document.getElementById('gymRoutineTimerMinutes');
    if(mode) mode.value = config.mode;
    if(minutes) minutes.value = String(Math.max(1,Math.round(config.duration/60)));
    updateRoutineTimerEditorUi();
  }
  function readRoutineTimerEditor(){
    const mode = document.getElementById('gymRoutineTimerMode')?.value || 'none';
    if(mode !== 'countdown') return { mode, duration:0 };
    const minutes = Math.round(Number(document.getElementById('gymRoutineTimerMinutes')?.value));
    if(!Number.isFinite(minutes) || minutes<1 || minutes>360){
      showToast('La cuenta atrás debe estar entre 1 y 360 minutos');
      document.getElementById('gymRoutineTimerMinutes')?.focus();
      return null;
    }
    return { mode, duration:minutes*60 };
  }

  const baseOpenAddRoutineTimer = openAddRoutine;
  openAddRoutine = function(){
    const result = baseOpenAddRoutineTimer.apply(this,arguments);
    renderRoutineTimerEditor(null);
    return result;
  };
  const baseEditRoutineTimer = editRoutine;
  editRoutine = function(id){
    const result = baseEditRoutineTimer.apply(this,arguments);
    renderRoutineTimerEditor(state.routines.find(routine=>routine.id===id));
    return result;
  };
  const baseSaveRoutineTimer = saveRoutine;
  saveRoutine = function(){
    const timerConfig = readRoutineTimerEditor();
    if(!timerConfig) return;
    const routineId = editingRoutineId;
    const routineCount = state.routines.length;
    const result = baseSaveRoutineTimer.apply(this,arguments);
    if(document.getElementById('overlayRoutine')?.classList.contains('open')) return result;
    const routine = routineId
      ? state.routines.find(item=>item.id===routineId)
      : (state.routines.length>routineCount ? state.routines[state.routines.length-1] : null);
    if(!routine) return result;
    routine.timerMode = timerConfig.mode;
    if(timerConfig.mode === 'countdown') routine.timerDurationSeconds = timerConfig.duration;
    else delete routine.timerDurationSeconds;
    save();
    renderRoutinesTab();
    return result;
  };
  const baseRenderRoutinesTimer = renderRoutinesTab;
  renderRoutinesTab = function(){
    const result = baseRenderRoutinesTimer.apply(this,arguments);
    decorateRoutineTimerBadges();
    return result;
  };
  const baseRefreshRoutineGridTimer = refreshWorkoutGridCards;
  refreshWorkoutGridCards = function(){
    const result = baseRefreshRoutineGridTimer.apply(this,arguments);
    decorateRoutineTimerBadges();
    return result;
  };

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

  function calendarHeartRateHtml(log){
    const values=heartValues(log);
    if(!values.length) return '';
    const metrics=healthForLog(log).metrics || {};
    const average=Number.isFinite(Number(metrics.averageHeartRate))
      ? Math.round(Number(metrics.averageHeartRate))
      : Math.round(values.reduce((sum,value)=>sum+value,0)/values.length);
    const maximum=Number.isFinite(Number(metrics.maxHeartRate))
      ? Math.round(Number(metrics.maxHeartRate))
      : Math.max(...values);
    const minimum=Math.min(...values);
    const minutes=Math.max(1,Math.round((Number(log.duration)||0)/60));
    const zones=zoneDurations(log);
    const zoneTotal=zones?.reduce((sum,seconds)=>sum+seconds,0) || 0;
    const zoneColors=['#60a5fa','#34d399','#facc15','#fb923c','#ef4444'];
    const zoneBar=zoneTotal ? `<div class="gym-calendar-hr-zones" aria-label="Tiempo por zonas">${zones.map((seconds,index)=>seconds > 0 ? `<span style="width:${Math.max(1,(seconds/zoneTotal)*100)}%;background:${zoneColors[index]}" title="Z${index+1}: ${Math.round(seconds/60)} min"></span>` : '').join('')}</div>` : '';
    return `<section class="gym-calendar-hr" data-log-id="${escapeAttribute(log.id)}">
      <div class="gym-calendar-hr-head">
        <div class="gym-calendar-hr-title"><span class="gym-calendar-hr-icon" aria-hidden="true">&#9829;</span><span>Frecuencia cardiaca<small>${values.length.toLocaleString('es-ES')} lecturas &middot; ${minutes} min</small></span></div>
        <button type="button" class="gym-calendar-hr-open" onclick="openHeartRateDetails('${escapeAttribute(log.id)}')">Ampliar</button>
      </div>
      <div class="gym-calendar-hr-stats">
        <span><small>Media</small><strong>${average}</strong><em>bpm</em></span>
        <span><small>M&aacute;xima</small><strong>${maximum}</strong><em>bpm</em></span>
        <span><small>M&iacute;nima</small><strong>${minimum}</strong><em>bpm</em></span>
      </div>
      <div class="gym-calendar-hr-chart"><canvas class="gym-calendar-hr-canvas" data-log-id="${escapeAttribute(log.id)}" aria-label="Grafica de frecuencia cardiaca de la sesion"></canvas><div class="gym-calendar-hr-tooltip"></div></div>
      ${zoneBar}
      <div class="gym-calendar-hr-axis"><span>Inicio</span><span>${minutes} min</span></div>
    </section>`;
  }

  function drawCalendarHeartRate(canvas,log){
    const values=heartValues(log);
    if(!canvas || !values.length) return;
    const rect=canvas.getBoundingClientRect();
    const dpr=window.devicePixelRatio || 1;
    const width=Math.max(260,Math.round(rect.width || 560));
    const height=Math.max(126,Math.round(rect.height || 150));
    canvas.width=width*dpr; canvas.height=height*dpr;
    const ctx=canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
    const pad=8,top=12,bottom=9,chartW=width-pad*2,chartH=height-top-bottom;
    const rawMin=Math.min(...values),rawMax=Math.max(...values);
    const min=Math.max(35,Math.floor(rawMin/10)*10-5);
    const max=Math.min(245,Math.ceil(rawMax/10)*10+5);
    const range=max-min || 1;
    const styles=getComputedStyle(document.documentElement);
    const border=styles.getPropertyValue('--border').trim() || 'rgba(255,255,255,.14)';
    const accent=styles.getPropertyValue('--done').trim() || '#34d399';
    const x=index=>pad+(index/(values.length-1||1))*chartW;
    const y=value=>top+chartH-((value-min)/range)*chartH;
    ctx.clearRect(0,0,width,height);
    ctx.lineWidth=1;
    for(let index=0;index<3;index++){
      const lineY=top+(chartH*index/2);
      ctx.strokeStyle=border; ctx.beginPath(); ctx.moveTo(pad,lineY); ctx.lineTo(width-pad,lineY); ctx.stroke();
    }
    const points=downsample(values,Math.min(360,Math.max(160,width)));
    const gradient=ctx.createLinearGradient(0,top,0,height);
    gradient.addColorStop(0,'rgba(52,211,153,.34)');
    gradient.addColorStop(1,'rgba(52,211,153,0)');
    ctx.beginPath();
    points.forEach((point,index)=>index ? ctx.lineTo(x(point.index),y(point.value)) : ctx.moveTo(x(point.index),y(point.value)));
    ctx.lineTo(x(values.length-1),height-bottom); ctx.lineTo(x(0),height-bottom); ctx.closePath();
    ctx.fillStyle=gradient; ctx.fill();
    ctx.beginPath();
    points.forEach((point,index)=>index ? ctx.lineTo(x(point.index),y(point.value)) : ctx.moveTo(x(point.index),y(point.value)));
    ctx.lineWidth=2.4; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.strokeStyle=accent; ctx.shadowColor='rgba(52,211,153,.45)'; ctx.shadowBlur=8; ctx.stroke(); ctx.shadowBlur=0;
    const average=values.reduce((sum,value)=>sum+value,0)/values.length;
    ctx.setLineDash([5,5]); ctx.strokeStyle='rgba(255,255,255,.35)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(pad,y(average)); ctx.lineTo(width-pad,y(average)); ctx.stroke(); ctx.setLineDash([]);

    const tooltip=canvas.parentElement?.querySelector('.gym-calendar-hr-tooltip');
    const showPoint=clientX=>{
      if(!tooltip) return;
      const bounds=canvas.getBoundingClientRect();
      const px=Math.max(0,Math.min(bounds.width,clientX-bounds.left));
      const index=Math.max(0,Math.min(values.length-1,Math.round((px/(bounds.width||1))*(values.length-1))));
      const minute=(Number(log.duration)||0)*(index/(values.length-1||1))/60;
      tooltip.textContent=`${values[index]} bpm \u00b7 min ${minute.toFixed(1)}`;
      tooltip.style.left=`${Math.max(48,Math.min(bounds.width-48,px))}px`;
      tooltip.classList.add('show');
    };
    canvas.onpointermove=event=>showPoint(event.clientX);
    canvas.onpointerdown=event=>showPoint(event.clientX);
    canvas.onpointerleave=()=>tooltip?.classList.remove('show');
  }

  function renderCalendarHeartRate(ds){
    const detail=document.getElementById('calDetail');
    if(!detail) return;
    const entries=state.workoutLog.filter(entry=>entry.date===ds);
    const cards=[...detail.querySelectorAll('.history-session-card')];
    cards.forEach((card,index)=>{
      card.querySelector('.gym-calendar-hr')?.remove();
      const log=entries[index],html=log ? calendarHeartRateHtml(log) : '';
      if(!html) return;
      const exercises=card.querySelector('.history-ex-list');
      exercises?.insertAdjacentHTML('beforebegin',html);
    });
    requestAnimationFrame(()=>detail.querySelectorAll('.gym-calendar-hr-canvas').forEach(canvas=>{
      const log=state.workoutLog.find(entry=>entry.id===canvas.dataset.logId);
      if(log) drawCalendarHeartRate(canvas,log);
    }));
  }

  const baseShowDayDetail = showDayDetail;
  showDayDetail = function(ds){
    const result=baseShowDayDetail.apply(this,arguments);
    renderCalendarHeartRate(ds);
    return result;
  };

  let calendarHeartRateResizeFrame=0;
  window.addEventListener('resize',()=>{
    cancelAnimationFrame(calendarHeartRateResizeFrame);
    calendarHeartRateResizeFrame=requestAnimationFrame(()=>{
      document.querySelectorAll('.gym-calendar-hr-canvas').forEach(canvas=>{
        const log=state.workoutLog.find(entry=>entry.id===canvas.dataset.logId);
        if(log) drawCalendarHeartRate(canvas,log);
      });
    });
  });

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

  function renderRestSettingsPanel(){
    const soundOptions = document.getElementById('soundOptions');
    if(!soundOptions) return;
    let panel = document.getElementById('gymRestSettings');
    if(!panel){
      panel = document.createElement('div');
      panel.id = 'gymRestSettings';
      panel.className = 'backup-card gym-rest-settings';
      panel.innerHTML = '<div class="chart-title">Descanso manual</div><div class="backup-copy">El temporizador solo empieza cuando pulsas <strong>Descanso</strong>. El cambio se aplicará al siguiente descanso.</div><div class="gym-rest-setting-row"><label for="gymRestSeconds">Duración en segundos <span>De 15 s a 10 min</span></label><div class="gym-rest-setting-controls"><input id="gymRestSeconds" type="number" inputmode="numeric" min="15" max="600" step="5" aria-describedby="gymRestSettingHelp"><button type="button" class="ghost-btn" id="gymSaveRestSeconds">Guardar</button></div></div><div class="backup-copy" id="gymRestSettingHelp">Valor actual: <strong id="gymRestSettingCurrent"></strong></div>';
      const anchor = soundOptions.closest('.backup-card');
      if(anchor) anchor.insertAdjacentElement('afterend',panel);
      else soundOptions.insertAdjacentElement('afterend',panel);
      panel.querySelector('#gymSaveRestSeconds')?.addEventListener('click',()=>{
        const input = panel.querySelector('#gymRestSeconds');
        const value = Math.round(Number(input?.value));
        if(!Number.isFinite(value) || value<MIN_MANUAL_REST_SECONDS || value>MAX_MANUAL_REST_SECONDS){
          showToast('El descanso debe estar entre 15 y 600 segundos');
          input?.focus();
          return;
        }
        state.settings = state.settings || {};
        state.settings.manualRestSeconds = value;
        save();
        renderRestSettingsPanel();
        updateWorkoutToolsUi();
        showToast('Descanso guardado: ' + formatRestSeconds(value));
      });
      panel.querySelector('#gymRestSeconds')?.addEventListener('keydown',event=>{
        if(event.key==='Enter') panel.querySelector('#gymSaveRestSeconds')?.click();
      });
    }
    const duration = configuredRestSeconds();
    const input = panel.querySelector('#gymRestSeconds');
    const current = panel.querySelector('#gymRestSettingCurrent');
    if(input) input.value = String(duration);
    if(current) current.textContent = formatRestSeconds(duration);
  }

  const baseRenderHealthSettings = renderHealthSettings;
  renderHealthSettings = function(){
    baseRenderHealthSettings();
    renderRestSettingsPanel();
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
      if(!needsFitbitRecovery(log)){
        await gymLogCloudClient.from('gymlog_health_recovery_queue').update({status:'cancelled',last_error:'outside_recovery_window',updated_at:new Date().toISOString()}).eq('user_id',row.user_id).eq('session_local_id',row.session_local_id).eq('attempt',row.attempt);
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
      .gym-cloud-status{position:fixed;top:calc(8px + env(safe-area-inset-top,0px));right:8px;bottom:auto!important;z-index:92;max-width:min(68vw,240px);box-sizing:border-box;border:1px solid var(--border);border-radius:999px;padding:6px 9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:800 10px DM Sans,sans-serif;color:var(--text);background:color-mix(in srgb,var(--bg) 90%,transparent);box-shadow:0 5px 16px rgba(0,0,0,.22);backdrop-filter:blur(12px);pointer-events:none;user-select:none;opacity:0;visibility:hidden;transform:translateY(-7px);transition:opacity .18s ease,transform .18s ease,visibility 0s linear .18s}.gym-cloud-status.visible{opacity:.88;visibility:visible;transform:translateY(0);transition-delay:0s}
      .gym-cloud-status.ok{color:var(--done)}.gym-cloud-status.pending,.gym-cloud-status.warning{color:var(--accent2)}.gym-cloud-status.error{color:#fca5a5}
      .gym-hr-overlay{display:none;position:fixed;inset:0;z-index:10020;background:rgba(0,0,0,.72);padding:16px;overflow:auto}.gym-hr-overlay.open{display:flex;align-items:center;justify-content:center}
      .gym-hr-dialog{width:min(760px,100%);max-height:92vh;overflow:auto;background:var(--bg);border:1px solid var(--border);border-radius:20px;padding:16px;box-shadow:0 28px 70px rgba(0,0,0,.55)}
      .gym-hr-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.gym-hr-subtitle{color:var(--muted);font-size:12px;margin-top:3px}
      .gym-hr-canvas-wrap{position:relative}.gym-hr-canvas-wrap canvas{width:100%;height:320px;display:block;touch-action:pan-y}.gym-hr-tooltip{display:none;position:absolute;left:50%;top:8px;transform:translateX(-50%);background:var(--surface);border:1px solid var(--border);padding:7px 10px;border-radius:999px;font-size:11px;font-weight:800;pointer-events:none}
      .gym-hr-stats,.gym-analysis-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.gym-hr-stats span,.gym-analysis-grid span{border:1px solid var(--border);background:var(--surface);border-radius:12px;padding:10px;color:var(--muted);font-size:11px}.gym-hr-stats strong,.gym-analysis-grid strong{display:block;color:var(--text);font-size:15px;margin-top:3px}
      .gym-health-analysis,.gym-health-profile{margin-top:12px;padding:14px;border:1px solid var(--border);border-radius:16px;background:var(--card)}.gym-profile-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.gym-profile-grid label{font-size:11px;color:var(--muted);font-weight:800}.gym-profile-grid input{width:100%;margin-top:5px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:9px;box-sizing:border-box}
      .gym-rest-settings{margin-bottom:12px}.gym-rest-setting-row{display:grid;gap:7px;margin-top:13px}.gym-rest-setting-row label{display:flex;align-items:baseline;justify-content:space-between;gap:8px;color:var(--text);font-size:12px;font-weight:900}.gym-rest-setting-row label span{color:var(--muted);font-size:10px;font-weight:700}.gym-rest-setting-controls{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.gym-rest-setting-controls input{min-width:0;width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:11px;background:var(--bg);color:var(--text);padding:10px 12px;font:800 14px DM Sans,sans-serif}.gym-rest-setting-controls .ghost-btn{min-height:42px}.gym-rest-settings #gymRestSettingHelp{margin-top:8px}.gym-rest-settings #gymRestSettingHelp strong{color:var(--accent2)}
      .gym-routine-timer-settings{margin:4px 0 18px;padding:14px;border:1px solid color-mix(in srgb,var(--accent) 24%,var(--border));border-radius:15px;background:color-mix(in srgb,var(--accent) 7%,var(--card))}.gym-routine-timer-settings-title{font-size:14px;font-weight:900}.gym-routine-timer-settings-copy{margin:4px 0 12px;color:var(--muted);font-size:11px;line-height:1.45}.gym-routine-timer-settings label{display:block;margin:10px 0 5px;color:var(--muted);font-size:11px;font-weight:800}.gym-routine-timer-settings select,.gym-routine-timer-settings input{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:11px;background:var(--bg);color:var(--text);padding:10px 11px;font:700 13px DM Sans,sans-serif}.gym-routine-timer-settings [hidden]{display:none!important}.gym-routine-timer-badge{border-color:color-mix(in srgb,var(--accent) 28%,var(--border))!important;color:var(--accent2)!important}
      .gym-routine-timer{position:relative;margin:14px 0;padding:16px;border:1px solid color-mix(in srgb,var(--accent) 34%,var(--border));border-radius:20px;background:radial-gradient(circle at 88% 8%,color-mix(in srgb,var(--accent) 18%,transparent),transparent 42%),linear-gradient(145deg,color-mix(in srgb,var(--accent) 9%,var(--card)),var(--card));box-shadow:0 14px 32px rgba(0,0,0,.22);overflow:hidden}.gym-routine-timer-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.gym-routine-timer-kicker{color:var(--accent2);font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.gym-routine-timer-status{margin-top:4px;color:var(--muted);font-size:11px;font-weight:800}.gym-routine-timer-dot{width:10px;height:10px;border-radius:50%;background:var(--muted);box-shadow:0 0 0 5px color-mix(in srgb,var(--muted) 14%,transparent)}.gym-routine-timer.running .gym-routine-timer-dot{background:var(--done);box-shadow:0 0 0 5px color-mix(in srgb,var(--done) 16%,transparent),0 0 18px color-mix(in srgb,var(--done) 60%,transparent)}.gym-routine-timer.finished{border-color:color-mix(in srgb,var(--accent2) 55%,var(--border))}.gym-routine-timer.finished .gym-routine-timer-dot{background:var(--accent2)}.gym-routine-timer-value{margin:8px 0 12px;color:var(--text);font:500 clamp(54px,18vw,82px)/.95 Bebas Neue,DM Sans,sans-serif;letter-spacing:.06em;text-align:center;font-variant-numeric:tabular-nums}.gym-routine-timer-actions{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:8px}.gym-routine-timer-actions button{min-height:46px;border:1px solid var(--border);border-radius:13px;background:rgba(255,255,255,.045);color:var(--text);font:900 12px DM Sans,sans-serif;cursor:pointer;touch-action:manipulation}.gym-routine-timer-actions button.primary{border-color:color-mix(in srgb,var(--accent) 38%,var(--border));background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent2)}.gym-routine-timer-note{margin-top:10px;color:var(--muted);font-size:10px;line-height:1.4;text-align:center}
      #phase-active .series-input.quick-replace-active{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,var(--bg));caret-color:var(--accent)}#phase-active .series-input.quick-replace-active::placeholder{color:var(--text);opacity:.3;font-weight:700}
      #phase-active .gym-series-stepper{position:relative;min-width:0;width:100%}#phase-active .gym-series-stepper .series-input{padding-left:27px;padding-right:27px;-moz-appearance:textfield}#phase-active .gym-series-stepper .series-input::-webkit-inner-spin-button,#phase-active .gym-series-stepper .series-input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}#phase-active .gym-series-step{position:absolute;top:50%;z-index:2;width:25px;height:36px;transform:translateY(-50%);border:0;background:transparent;color:var(--muted);font-size:19px;font-weight:900;line-height:1;cursor:pointer;touch-action:manipulation;opacity:.72}#phase-active .gym-series-step.minus{left:1px}#phase-active .gym-series-step.plus{right:1px}#phase-active .gym-series-step:active{color:var(--accent2);opacity:1;transform:translateY(-50%) scale(.92)}
      #phase-active .gym-workout-tools{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) minmax(92px,.62fr);gap:7px;min-width:0}#phase-active .gym-rest-control{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px;min-width:0}#phase-active .gym-workout-tool,#phase-active .gym-rest-cancel{min-height:36px;border:1px solid rgba(255,255,255,.09);border-radius:11px;background:rgba(255,255,255,.045);color:var(--text);font:800 11px DM Sans,sans-serif;cursor:pointer;touch-action:manipulation}#phase-active .gym-workout-tool.running{color:var(--accent2);border-color:color-mix(in srgb,var(--accent) 38%,transparent);background:color-mix(in srgb,var(--accent) 12%,transparent)}#phase-active .gym-workout-tool.undo{color:var(--muted)}#phase-active .gym-workout-tool.undo:not(:disabled){color:var(--text)}#phase-active .gym-workout-tool:disabled{cursor:default;opacity:.46}#phase-active .gym-rest-cancel{width:36px;color:#fca5a5;font-size:18px}body.gym-workout-tools-active .gym-cloud-status{bottom:calc(126px + env(safe-area-inset-bottom,0px))}body.gym-workout-tools-active #phase-active .finish-section{padding-bottom:132px}
      .gym-calendar-hr{position:relative;box-sizing:border-box;max-width:100%;margin:14px 0 4px;padding:14px;border:1px solid color-mix(in srgb,var(--done) 24%,var(--border));border-radius:17px;background:linear-gradient(145deg,color-mix(in srgb,var(--done) 10%,var(--card)),color-mix(in srgb,var(--bg) 96%,transparent));overflow:hidden}.gym-calendar-hr:before{content:\x27\x27;position:absolute;width:150px;height:150px;right:-70px;top:-95px;border-radius:50%;background:color-mix(in srgb,var(--done) 16%,transparent);filter:blur(4px);pointer-events:none}.gym-calendar-hr-head,.gym-calendar-hr-title{display:flex;align-items:center}.gym-calendar-hr-head{position:relative;z-index:1;justify-content:space-between;gap:10px;min-width:0}.gym-calendar-hr-title{min-width:0}.gym-calendar-hr-open{flex:0 0 auto}.gym-calendar-hr-title{gap:9px;font-size:13px;font-weight:900}.gym-calendar-hr-title small{display:block;margin-top:2px;color:var(--muted);font-size:10px;font-weight:700}.gym-calendar-hr-icon{display:grid;place-items:center;width:31px;height:31px;border-radius:10px;color:#fff;background:linear-gradient(145deg,#fb7185,#ef4444);box-shadow:0 6px 16px rgba(239,68,68,.28);font-size:16px}.gym-calendar-hr-open{border:1px solid color-mix(in srgb,var(--done) 28%,var(--border));background:color-mix(in srgb,var(--done) 12%,var(--surface));color:var(--text);border-radius:10px;padding:7px 10px;font-size:10px;font-weight:900;cursor:pointer}.gym-calendar-hr-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:12px 0 6px}.gym-calendar-hr-stats span{display:grid;grid-template-columns:auto auto;align-items:baseline;justify-content:start;column-gap:3px;padding:8px 9px;border-radius:11px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.06)}.gym-calendar-hr-stats small{grid-column:1/-1;color:var(--muted);font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}.gym-calendar-hr-stats strong{font-size:18px;line-height:1.15}.gym-calendar-hr-stats em{color:var(--muted);font-size:9px;font-style:normal;font-weight:800}.gym-calendar-hr-chart{position:relative;height:150px;margin-top:2px}.gym-calendar-hr-canvas{display:block;width:100%;height:150px;touch-action:pan-y}.gym-calendar-hr-tooltip{position:absolute;top:5px;display:none;transform:translateX(-50%);padding:6px 8px;border:1px solid var(--border);border-radius:999px;background:color-mix(in srgb,var(--bg) 92%,transparent);box-shadow:0 7px 18px rgba(0,0,0,.28);font-size:9px;font-weight:900;white-space:nowrap;pointer-events:none}.gym-calendar-hr-tooltip.show{display:block}.gym-calendar-hr-zones{display:flex;height:4px;margin:3px 8px 0;overflow:hidden;border-radius:99px;background:rgba(255,255,255,.06)}.gym-calendar-hr-zones span{display:block;height:100%}.gym-calendar-hr-axis{display:flex;justify-content:space-between;margin:5px 8px 0;color:var(--muted);font-size:9px;font-weight:800}
      .gym-note-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}.gym-note-toolbar span{color:var(--muted);font-size:11px}.gym-note-start{margin-left:6px}
      .gym-update-prompt{position:fixed;left:12px;right:12px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:10030;display:flex;align-items:center;gap:10px;background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:10px 12px;box-shadow:0 18px 40px rgba(0,0,0,.45)}.gym-update-prompt span{flex:1;font-weight:800}.gym-update-prompt button{border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:10px;padding:8px 10px;font-weight:800}
      @media(max-width:640px){.gym-hr-stats,.gym-analysis-grid,.gym-profile-grid{grid-template-columns:1fr 1fr}.gym-hr-canvas-wrap canvas{height:270px}.gym-cloud-status{bottom:calc(78px + env(safe-area-inset-bottom,0px))}body.gym-workout-tools-active .gym-cloud-status{bottom:calc(122px + env(safe-area-inset-bottom,0px))}.gym-calendar-hr{padding:12px;margin-inline:-2px}.gym-calendar-hr-chart,.gym-calendar-hr-canvas{height:138px}.gym-calendar-hr-stats strong{font-size:17px}#phase-active .gym-series-step{height:32px;width:23px;font-size:18px}#phase-active .gym-series-stepper .series-input{padding-left:24px;padding-right:24px}#phase-active .gym-workout-tools{grid-template-columns:minmax(0,1fr) 96px}}
      .health-actions-primary{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:12px}.health-actions-primary .ghost-btn{min-height:46px}.health-actions-primary .ghost-btn[hidden]{display:none}.gym-health-more{margin-top:10px;border:1px solid var(--border);border-radius:14px;background:color-mix(in srgb,var(--surface) 72%,transparent);overflow:hidden}.gym-health-more summary{padding:13px 14px;color:var(--text);font-size:12px;font-weight:900;cursor:pointer;list-style:none;touch-action:manipulation}.gym-health-more summary::-webkit-details-marker{display:none}.gym-health-more summary:after{content:'+';float:right;color:var(--accent2);font-size:17px;line-height:.8}.gym-health-more[open] summary:after{content:'-'}.gym-health-more[open] summary{border-bottom:1px solid var(--border)}.gym-health-more-title{margin:14px 14px 8px;color:var(--muted);font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.gym-health-more .health-actions{padding:0 12px}.gym-health-more .health-note{margin:8px 14px 2px}.gym-health-more .gym-health-signout{width:calc(100% - 24px);margin:14px 12px 12px;color:#fca5a5}
      @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}.gym-cloud-status,.gym-update-prompt{transition:none!important}}
    `;
    document.head.appendChild(style);
  }

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'&&readPendingState()) saveUserCloudState({immediate:true,silent:true});
    if(document.visibilityState==='visible'){ processHealthRecoveryQueue(); tickManualRestTimer(); tickRoutineTimer(); }
  });
  window.addEventListener('pagehide',()=>{ if(readPendingState()) saveUserCloudState({immediate:true,silent:true}); });
  window.addEventListener('online',()=>{ setCloudStatus('pending','Nube: reconectando'); saveUserCloudState({silent:true}); processHealthRecoveryQueue(); });
  window.addEventListener('offline',()=>setCloudStatus('warning','Offline · guardado local'));
  window.addEventListener('keydown',event=>{ if(event.key==='Escape') closeHeartRateDetails(); });

  async function bootReliability(){
    revealAppContent(); installStyles(); cloudStatusElement(); ensureHeartRateModal(); appendNoteCatalogControls(); enhanceActiveWorkoutControls(); renderRestSettingsPanel(); decorateRoutineTimerBadges(); await registerPwa();
    setTimeout(async()=>{ await loadHealthProfile(); renderHealthSettings(); processHealthRecoveryQueue(); },2500);
    setInterval(processHealthRecoveryQueue,5*60*1000);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bootReliability,{once:true});
  else bootReliability();
})();
