// Bộ sinh số ngẫu nhiên có seed cố định (mulberry32) để giả lập, chia train/test cho ra cùng kết quả mỗi lần chạy.
// Math.random() không đặt được seed nên không dùng.
function createRng(seed = 2026) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)), // số nguyên trong [min, max]
    pick: (list) => list[Math.floor(next() * list.length)],
    // Chọn k phần tử khác nhau
    sample(list, k) {
      const copy = list.slice()
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
      }
      return copy.slice(0, Math.min(k, copy.length))
    },
    // Phân phối chuẩn N(0, 1) theo Box-Muller
    gauss() {
      const u = Math.max(next(), 1e-12)
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
    },
  }
}

module.exports = { createRng }
