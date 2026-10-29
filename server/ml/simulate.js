// Sinh dữ liệu giả lập cho mô hình gợi ý (đề cương Học máy mục 6.3: chưa có dữ liệu thật thì giả lập có kiểm soát).
//
// Cách sinh:
// 1. Catalog 60 sản phẩm của dataset (ml/catalog.js, 57 sản phẩm đủ điều kiện gợi ý), điểm đánh giá và lượt bán lấy
//    từ dataset 1,5 năm (có cả hàng mới chưa có đánh giá). Catalog không có số liệu này (mọi sản phẩm chưa bán) thì
//    gán giả: 30% chưa có đánh giá, còn lại điểm U(3,6; 5,0); 40% chưa bán, còn lại 1-400 lượt (cố định theo seed).
// 2. Mỗi kịch bản khảo sát chọn ngẫu nhiên: người nhận (60%), 0-2 dịp (70% có), 0-2 sở thích (75%), 0-2 tính cách hoặc
//    phong cách (50%), 1 tag rút từ mô tả (30%), khoảng tuổi (50%), ngân sách (75%, 40% trong đó có mức tối thiểu),
//    muốn khắc tên (15%). Kịch bản rỗng thì thêm 1 sở thích.
// 3. Mỗi cặp (kịch bản, sản phẩm) là 1 dòng. Nhãn "phù hợp" theo quy tắc "người mua giả lập":
//      u = 2,2·sở thích + 1,4·dịp + 0,9·tính cách + 1,1·người nhận + 1,6·mô tả + 1,2·trong ngân sách
//          - 3·vượt ngân sách + 0,8·độ tuổi + 0,4·(đánh giá - 4) + 0,3·phổ biến + 1·muốn khắc tên + nhiễu N(0; 0,6)
//    nhãn = 1 khi u ≥ 2,8; thêm 3% nhãn bị lật ngẫu nhiên (người mua đổi ý). Trọng số này là giả định của nhóm phát triển,
//    mô hình không biết trước, chỉ học lại từ dữ liệu.
const { createRng } = require("./rng")
const { buildFeatures } = require("./features")

const RULE = { hobby: 2.2, occasion: 1.4, personality: 0.9, recipient: 1.1, note: 1.6, inBudget: 1.2, over: -3, age: 0.8, rating: 0.4, popularity: 0.3, personalization: 1, noise: 0.6, threshold: 2.8, flip: 0.03 }

const BUDGET_STEPS = [150000, 200000, 300000, 400000, 500000, 600000, 800000, 1000000, 1200000]

function randomScenario(rng, byGroup) {
  const c = { recipient: null, occasions: [], hobbies: [], personalities: [], noteTags: [], ageMin: null, ageMax: null, budgetMin: 0, budgetMax: null, preferPersonalized: false }
  if (rng.next() < 0.6) c.recipient = rng.pick(byGroup("DOI_TUONG"))
  if (rng.next() < 0.7) c.occasions = rng.sample(byGroup("DIP_TANG"), rng.int(1, 2))
  if (rng.next() < 0.75) c.hobbies = rng.sample(byGroup("SO_THICH"), rng.int(1, 2))
  if (rng.next() < 0.5) c.personalities = rng.sample([...byGroup("TINH_CACH"), ...byGroup("PHONG_CACH")], rng.int(1, 2))
  if (rng.next() < 0.3) c.noteTags = [rng.pick([...byGroup("SO_THICH"), ...byGroup("CONG_DUNG")])]
  if (rng.next() < 0.5) {
    c.ageMin = rng.int(6, 35)
    c.ageMax = Math.min(40, c.ageMin + rng.int(3, 15))
  }
  if (rng.next() < 0.75) {
    c.budgetMax = rng.pick(BUDGET_STEPS)
    if (rng.next() < 0.4) c.budgetMin = Math.round((c.budgetMax * 0.4) / 50000) * 50000
  }
  c.preferPersonalized = rng.next() < 0.15
  const empty = !c.recipient && !c.occasions.length && !c.hobbies.length && !c.personalities.length && !c.noteTags.length && c.ageMin == null && c.budgetMax == null
  if (empty) c.hobbies = [rng.pick(byGroup("SO_THICH"))]
  return c
}

// Nhãn của người mua giả lập từ vector đặc trưng (cùng thứ tự FEATURE_NAMES)
function simulatedLabel(x, rng) {
  const [occ, hob, pers, rec, note, inB, over, age, rating, pop, pz] = x
  const u =
    RULE.hobby * hob + RULE.occasion * occ + RULE.personality * pers + RULE.recipient * rec + RULE.note * note +
    RULE.inBudget * inB + RULE.over * over + RULE.age * age + RULE.rating * (rating * 5 - 4) + RULE.popularity * pop +
    RULE.personalization * pz + RULE.noise * rng.gauss()
  let y = u >= RULE.threshold ? 1 : 0
  if (rng.next() < RULE.flip) y = 1 - y
  return y
}

function simulate(catalog, { scenarios = 600, seed = 2026 } = {}) {
  const rng = createRng(seed)
  const hasStats = catalog.items.some((it) => it.sold > 0)
  const items = hasStats
    ? catalog.items
    : catalog.items.map((it) => ({
        ...it,
        rating: rng.next() < 0.3 ? 0 : Math.round((3.6 + rng.next() * 1.4) * 10) / 10,
        sold: rng.next() < 0.4 ? 0 : rng.int(1, 400),
      }))
  const rows = []
  const list = []
  for (let s = 0; s < scenarios; s++) {
    const c = randomScenario(rng, catalog.byGroup)
    list.push(c)
    for (const item of items) {
      const x = buildFeatures(c, item)
      rows.push({ scenario: s, itemId: item.id, x, y: simulatedLabel(x, rng) })
    }
  }
  return { scenarios: list, rows, items }
}

module.exports = { simulate, randomScenario, simulatedLabel, RULE }
