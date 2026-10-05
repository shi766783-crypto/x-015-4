export function createStorage(key, seed) {
  const read = () => { try { return JSON.parse(localStorage.getItem(key)) || structuredClone(seed) } catch { return structuredClone(seed) } }
  const write = (value) => localStorage.setItem(key, JSON.stringify(value))
  return { read, write }
}
