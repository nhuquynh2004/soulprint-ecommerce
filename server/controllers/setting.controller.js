// API-143 GET /api/settings/public - phí và thông tin cửa hàng cho giỏ hàng, hộp thoại cá nhân hóa, footer.
const { getStoreSettings } = require("../services/settings")

async function getPublicSettings(req, res) {
  res.send(await getStoreSettings())
}

module.exports = { getPublicSettings }
