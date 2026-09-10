// Rarity is derived from coin_cost, not chosen independently.
function computeRarityTier(coinCost) {
  if (coinCost < 50) return 'Обычная';
  if (coinCost < 200) return 'Редкая';
  if (coinCost < 500) return 'Особая';
  return 'Легендарная';
}

module.exports = { computeRarityTier };
