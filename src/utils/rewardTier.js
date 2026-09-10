// Rarity is derived from coin_cost, not chosen independently — thresholds
// picked for the current starter reward set (10-500 coins); revisit if the
// typical price range shifts.
function computeRarityTier(coinCost) {
  if (coinCost < 20) return 'Обычная';
  if (coinCost < 50) return 'Редкая';
  if (coinCost < 500) return 'Особая';
  return 'Легендарная';
}

module.exports = { computeRarityTier };
