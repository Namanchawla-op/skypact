const map = new Map();
export const bus = {
  on(evt, fn) { (map.get(evt) || map.set(evt, new Set()).get(evt)).add(fn); return () => map.get(evt)?.delete(fn); },
  emit(evt, data) { map.get(evt)?.forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); },
};
