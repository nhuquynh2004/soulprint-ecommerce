const express = require("express")
const { getHealth } = require("../controllers/health.controller")

const router = express.Router()

router.get("/health", getHealth) // API-232

module.exports = router
