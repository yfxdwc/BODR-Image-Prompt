/**
 * multiImage/ — A/B 留下的单一多图组件 (2026-06-20 精简)
 *
 * 历史: 原本 4 套 (Carousel / CardStack / Photos / Grid) + DesignPicker 切换器
 *       OH 6/18 起的 poker-deck 设计, 主人 12:51 明确"扑克牌堆叠"单效果, 不要切换器
 *       → 删 Carousel + Grid + DesignPicker (490 行)
 *
 * 当前: CardStackGallery (核心, 主人认可) + PhotosStyleGallery (备选, 将来扩展)
 *       + DemoFrame (CardStack/Photos 用的测试包装) + types/utils
 *
 * 使用: 现在没人 import (ItemDetailModal 改用内置 scatter stack css 实现)
 *       保留供将来其他场景 (产品页 / 搜索结果) 嵌入多图组件
 */
export { default as CardStackGallery } from './CardStackGallery';
export { default as PhotosStyleGallery } from './PhotosStyleGallery';
export type { MultiImageDesignId, MultiImageViewerComponent, MultiImageViewerProps } from './types';
export { buildDemoVariants, shouldExpandDemoImages } from './utils';
