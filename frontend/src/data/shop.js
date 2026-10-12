// 临时测试价格；测试结束后将此开关改为 false 恢复正常价格。
export const SHOP_TEST_PRICES = true;
export const SHOP_CATALOG = [
  { id: 'theme-warm', type: 'theme', theme: 'warm', price: SHOP_TEST_PRICES ? 0 : 40 },
  { id: 'theme-blue', type: 'theme', theme: 'blue', price: SHOP_TEST_PRICES ? 0 : 60 },
  { id: 'theme-night', type: 'theme', theme: 'night', price: SHOP_TEST_PRICES ? 0 : 100 },
  { id: 'theme-eye', type: 'theme', theme: 'eye', price: SHOP_TEST_PRICES ? 0 : 80 },
  { id: 'avatar-star', type: 'avatar', avatarId: 'star', price: SHOP_TEST_PRICES ? 0 : 60 },
  { id: 'avatar-fox', type: 'avatar', avatarId: 'fox', price: SHOP_TEST_PRICES ? 0 : 80 },
  { id: 'avatar-jade', type: 'avatar', avatarId: 'jade', price: SHOP_TEST_PRICES ? 0 : 100 },
  { id: 'avatar-male-sage', type: 'avatar', avatarId: 'male-sage', price: SHOP_TEST_PRICES ? 0 : 60 },
  { id: 'badge-milk-tea', type: 'frame', frameId: 'milk-tea', price: SHOP_TEST_PRICES ? 0 : 60 },
  { id: 'badge-pineapple', type: 'frame', frameId: 'pineapple', price: SHOP_TEST_PRICES ? 0 : 80 },
  { id: 'badge-tram', type: 'frame', frameId: 'tram', price: SHOP_TEST_PRICES ? 0 : 80 },
];
