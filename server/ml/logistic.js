// Logistic Regression viết tay (đề cương Học máy Chương 4.2): p = sigmoid(w·x + b),
// train bằng gradient descent theo lô đầy đủ, hàm mất mát log-loss có phạt L2 (không phạt bias).

function sigmoid(z) {
  // Tách 2 nhánh để exp không tràn số khi |z| lớn
  if (z >= 0) return 1 / (1 + Math.exp(-z))
  const e = Math.exp(z)
  return e / (1 + e)
}

const dot = (w, x) => w.reduce((s, wj, j) => s + wj * x[j], 0)

// Xác suất "phù hợp" của 1 vector đã chuẩn hóa
const predictProba = (model, x) => sigmoid(dot(model.weights, x) + model.bias)

function logLoss(weights, bias, X, y, l2) {
  let loss = 0
  for (let i = 0; i < X.length; i++) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, sigmoid(dot(weights, X[i]) + bias)))
    loss -= y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p)
  }
  return loss / X.length + (l2 / 2) * weights.reduce((s, w) => s + w * w, 0)
}

// X: mảng vector đã chuẩn hóa, y: nhãn 0/1. Trả {weights, bias, history (log-loss mỗi 100 vòng)}
function train(X, y, { learningRate = 0.5, epochs = 1500, l2 = 0.001 } = {}) {
  const n = X.length
  const d = X[0].length
  const weights = new Array(d).fill(0)
  let bias = 0
  const history = []
  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad = new Array(d).fill(0)
    let gradB = 0
    for (let i = 0; i < n; i++) {
      const err = sigmoid(dot(weights, X[i]) + bias) - y[i]
      for (let j = 0; j < d; j++) grad[j] += err * X[i][j]
      gradB += err
    }
    for (let j = 0; j < d; j++) weights[j] -= learningRate * (grad[j] / n + l2 * weights[j])
    bias -= learningRate * (gradB / n)
    if (epoch % 100 === 0 || epoch === epochs - 1) history.push({ epoch, loss: logLoss(weights, bias, X, y, l2) })
  }
  return { weights, bias, history }
}

module.exports = { sigmoid, predictProba, train, logLoss }
