-- Migration 011: Product detail redesign (2026-07-04 主人拍)
-- 背景: ProductModal 重设计为上下两区, 上区三栏:
--   左 = 产品信息 (name / series / spec / selling_points / after_sales / certifications)
--   中 = 当前选中缩略图大图
--   右 = 当前选中产品图的特定提示词 (风格/场景/展台/logo呈现方式/宣传标语)
-- 下区 = 缩略图集 + 上传区 (尾部), 选中稍大, 滚轮切换
--
-- 字段变更:
--   products: + after_sales TEXT, certifications TEXT
--   product_images: + style TEXT, scene TEXT, display_stage TEXT,
--                       logo_presentation TEXT, slogan TEXT

-- 1. products 表加 after_sales / certifications
ALTER TABLE products ADD COLUMN after_sales TEXT;
ALTER TABLE products ADD COLUMN certifications TEXT;

-- 2. product_images 表加 5 个提示词字段
ALTER TABLE product_images ADD COLUMN style TEXT;
ALTER TABLE product_images ADD COLUMN scene TEXT;
ALTER TABLE product_images ADD COLUMN display_stage TEXT;
ALTER TABLE product_images ADD COLUMN logo_presentation TEXT;
ALTER TABLE product_images ADD COLUMN slogan TEXT;