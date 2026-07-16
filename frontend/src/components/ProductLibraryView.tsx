import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Download, Image as ImageIcon, Loader2, Pencil, Sparkles, Star, Trash2, Upload, X } from 'lucide-react';
import { api } from '../api/client';
import type { CategoryRecord, Product, ProductDetail, ProductImageRecord, SeriesRecord } from '../types';
import type { Translator } from '../utils/i18n';
import { extractImageFromPasteEvent } from '../utils/clipboard';

const SPEC_PREVIEW_LENGTH = 80;
const SELLING_POINTS_PREVIEW_LENGTH = 60;
const STACK_PREVIEW_COUNT = 4;  // 卡片堆叠最多 4 张, 超出显示 +N
const MAX_IMAGES_PER_PRODUCT = 24;  // 2026-07-04 主人拍: 每款产品图集上限 24 张

// 2026-07-12 主人拍: 搜索高亮 (A 强化). 把 text 里命中 q 的子串包成 <mark>.
// 不区分大小写, 中英文混排都能命中. 没命中 → 原样返回.
function highlightText(text: string | null | undefined, q: string | undefined): ReactNode {
  const value = text ?? '';
  if (!q || !q.trim() || !value) return value;
  const needle = q.trim();
  // 转义正则元字符; 中英文混排都按字面匹配
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'gi');
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(value)) !== null) {
    if (m.index > last) parts.push(value.slice(last, m.index));
    parts.push(<mark key={`mk-${key++}`} className="search-highlight">{m[0]}</mark>);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;  // 防御零长匹配
  }
  if (last < value.length) parts.push(value.slice(last));
  return <>{parts}</>;
}

// ── 工具: 把 product_image 路径转成可访问 URL ─────────────────────────────────
function imageSrc(image: ProductImageRecord, kind: 'thumb' | 'preview' | 'original' = 'thumb'): string {
  const path = kind === 'thumb' ? (image.thumb_path || image.preview_path || image.original_path)
            : kind === 'preview' ? (image.preview_path || image.original_path)
            : image.original_path;
  if (!path) return '';
  return `/media/${path}`;
}


// ── 左栏: 产品信息 (可编辑) ───────────────────────────────────────────────────
// 2026-07-05 09:35 主人拍: 新增弹窗未点 Save 不入库. isCreating=true → handleSave 走 POST /products
function ProductInfoPanel({
  product,
  editing,
  onToggleEdit,
  onSaved,
  onCreateSubmit,
  t,
  isAdmin = true,                  // 2026-07-13 主人拍: 普通用户只读, 不显示编辑按钮和 +新建 字典项
}: {
  product: ProductDetail;
  editing: boolean;
  onToggleEdit: () => void;
  onSaved: (updated: ProductDetail) => void;
  // 2026-07-05 09:35: 新建模式的保存回调. 不传 → 走 PATCH (编辑现有产品)
  onCreateSubmit?: (fields: { name: string; series?: string; category?: string; spec?: string; selling_points?: string; after_sales?: string; certifications?: string }) => Promise<ProductDetail>;
  t: Translator;
  isAdmin?: boolean;
}) {
  const [category, setCategory] = useState(product.category ?? '');
  const [name, setName] = useState(product.name);
  const [series, setSeries] = useState(product.series ?? '');
  const [spec, setSpec] = useState(product.spec ?? '');
  const [sellingPoints, setSellingPoints] = useState(product.selling_points ?? '');
  const [afterSales, setAfterSales] = useState(product.after_sales ?? '');
  const [certifications, setCertifications] = useState(product.certifications ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 2026-07-06: 类别 + 系列下拉字典 (master data). 拉一次, modal 关闭再开 refresh.
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesRecord[]>([]);
  // “+新建” 划块状态 (纽多 input 块挂载在 select 下面)
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [creatingSeries, setCreatingSeries] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newSeriesName, setNewSeriesName] = useState('');
  const [dictBusy, setDictBusy] = useState(false);

  const refreshDictionary = async (opts?: { categoryId?: number }) => {
    // 2026-07-07 主人拍 A 方案: 品类和系列父子关系联动.
    // opts.categoryId != null → 后端按 category_id 过滤 series
    // opts 不传 → 全量 series (产品编辑初始打开时)
    try {
      const [cats, sers] = await Promise.all([
        api.products.listCategories(),
        api.products.listSeries(opts?.categoryId),
      ]);
      setCategories(cats.items);
      setSeriesList(sers.items);
    } catch {
      // 静默失败 = 编辑模式可见 “新建” 路径
    }
  };

  // category onChange 联动 series 下拉: 选了某品类后, series 下拉只显示该品类下的系列
  const handleCategoryChange = (newCategoryName: string) => {
    setCategory(newCategoryName);
    // 找 category id → 调 listSeries(category_id)
    const cat = categories.find(c => c.name === newCategoryName);
    if (cat) {
      refreshDictionary({ categoryId: cat.id });
      // 如果当前 series 不在新 category 的列表里, 清空 (避免隐项)
      // 注意: 这里不严格检查, 让用户手动选, 避免死循环 race
    } else {
      // category 为空 → 全量 series
      refreshDictionary();
    }
  };

  // 2026-07-16 主人拍: 初始打开编辑时, 若 product 已有 category, 立即按 category_id 过滤 series,
  // 避免下拉里出现 "浴霸" 品类 + "晾衣机" 系列的错配组合. category 改变时由 handleCategoryChange 重新拉.
  useEffect(() => {
    if (!editing) return;
    const cat = (product.category
      ? (categories.length ? categories : null) || (categories as any)
      : null);
    // 第一次进入编辑时 categories 还没拉, 走全量; 下个 effect 拿到 product.category 后再过滤一次.
    refreshDictionary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, product.id]);

  // 每次 product 变化 (例如 PATCH 后) 同步本地状态
  useEffect(() => {
    setCategory(product.category ?? '');
    setName(product.name);
    setSeries(product.series ?? '');
    setSpec(product.spec ?? '');
    setSellingPoints(product.selling_points ?? '');
    setAfterSales(product.after_sales ?? '');
    setCertifications(product.certifications ?? '');
  }, [product.id, product.category, product.name, product.series, product.spec, product.selling_points, product.after_sales, product.certifications]);

  // 2026-07-16 主人拍: 打开编辑且 product 有 category 时, 按 category_id 拉 series.
  // categories 拉到位后会再触发一次.
  useEffect(() => {
    if (!editing) return;
    if (!product.category) return;
    if (categories.length === 0) return;
    const cat = categories.find(c => c.name === product.category);
    if (cat) refreshDictionary({ categoryId: cat.id });
  }, [editing, product.category, categories.length]);

  // 2026-07-06: 创建新字典项成功后, 自动选中和关闭
  const handleCreateCategory = async () => {
    const v = newCategoryName.trim();
    if (!v) return;
    setDictBusy(true);
    try {
      const updated = await api.products.createCategory({ name: v });
      setCategories(updated.items);
      setCreatingCategory(false);
      setNewCategoryName('');
      setCategory(v);
    } catch (e: any) {
      setError(e?.message || 'Category create failed');
    } finally {
      setDictBusy(false);
    }
  };
  const handleCreateSeries = async () => {
    const v = newSeriesName.trim();
    if (!v) return;
    const cat = categories.find(c => c.name === category);
    if (!cat) {
      setError('请先选择一个分类再新建系列');
      return;
    }
    setDictBusy(true);
    try {
      const updated = await api.products.createSeries({ name: v, category_id: cat.id });
      setSeriesList(updated.items);
      setCreatingSeries(false);
      setNewSeriesName('');
      setSeries(v);
    } catch (e: any) {
      setError(e?.message || 'Series create failed');
    } finally {
      setDictBusy(false);
    }
  };

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      let updated: ProductDetail;
      if (onCreateSubmit) {
        // 2026-07-05 09:35 新建模式: 走 POST /products, name 必填
        const fields: any = { name };
        if (category) fields.category = category;
        if (series) fields.series = series;
        if (spec) fields.spec = spec;
        if (sellingPoints) fields.selling_points = sellingPoints;
        if (afterSales) fields.after_sales = afterSales;
        if (certifications) fields.certifications = certifications;
        updated = await onCreateSubmit(fields);
      } else {
        updated = await api.products.updateInfo(product.id, {
          category,
          name,
          series,
          spec,
          selling_points: sellingPoints,
          after_sales: afterSales,
          certifications,
        });
      }
      onSaved(updated);
      onToggleEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function renderReadonly(label: string, value: string | null | undefined) {
    const text = (value ?? '').trim();
    return (
      <div className="product-info-field">
        <span className="product-info-field-label">{label}</span>
        <div className={`product-info-readonly${text ? '' : ' is-empty'}`}>
          {text || '—'}
        </div>
      </div>
    );
  }

  return (
    <div className="product-modal-col">
      <div className="product-modal-col-header">
        <span className="product-modal-col-title">{t('productInfo') || '产品信息'}</span>
        <div className="product-modal-col-actions">
          {/* 2026-07-13 主人拍: 普通用户不显示编辑/保存/取消 按钮, modal 是只读的 */}
          {isAdmin && (!editing ? (
            <button type="button" className="product-modal-edit-toggle" onClick={onToggleEdit}>
              <Pencil size={11} /> {t('edit') || '编辑'}
            </button>
          ) : (
            <>
              <button type="button" className="product-modal-edit-toggle" onClick={onToggleEdit} disabled={busy}>
                {t('cancel') || '取消'}
              </button>
              <button type="button" className="product-modal-save-btn" onClick={handleSave} disabled={busy}>
                <Check size={11} /> {t('save') || '保存'}
              </button>
            </>
          ))}
        </div>
      </div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {editing ? (
        <>
          <div className="product-info-field-row">
            <div className="product-info-field">
              <span className="product-info-field-label">{t('category') || '产品类别'}</span>
              <div className="product-info-dict-row">
                <select
                  className="product-info-input is-short"
                  value={category}
                  onChange={e => {
                    if (e.target.value === '__create__') {
                      setCreatingCategory(true);
                    } else {
                      handleCategoryChange(e.target.value);
                    }
                  }}
                >
                  <option value="">{t('categoryPlaceholder') || '— 未设置 —'}</option>
                  {categories.map(c => <option key={c.id} value={c.name}>{c.name} ({c.count})</option>)}
                  {/* 2026-07-13 主人拍: 普通用户不显示 +新建 类别 */}
                  {isAdmin && <option value="__create__">{t('categoryCreateNew') || '+ 新建类别…'}</option>}
                </select>
              </div>
              {creatingCategory ? (
                <div className="product-info-dict-create">
                  <input
                    className="product-info-input is-short"
                    value={newCategoryName}
                    onChange={e => setNewCategoryName(e.target.value)}
                    placeholder={t('categoryNewPlaceholder') || '新类别名'}
                    autoFocus
                    disabled={dictBusy}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreateCategory(); if (e.key === 'Escape') { setCreatingCategory(false); setNewCategoryName(''); } }}
                  />
                  <button type="button" className="product-info-dict-create-btn" disabled={dictBusy || !newCategoryName.trim()} onClick={handleCreateCategory}>{t('confirm') || '确定'}</button>
                  <button type="button" className="product-info-dict-create-btn" disabled={dictBusy} onClick={() => { setCreatingCategory(false); setNewCategoryName(''); }}>{t('cancel') || '取消'}</button>
                </div>
              ) : null}
            </div>
            <div className="product-info-field">
              <span className="product-info-field-label">{t('series') || '系列'}</span>
              <div className="product-info-dict-row">
                <select
                  className="product-info-input is-short"
                  value={series}
                  onChange={e => {
                    if (e.target.value === '__create__') {
                      setCreatingSeries(true);
                    } else {
                      setSeries(e.target.value);
                    }
                  }}
                >
                  <option value="">{t('seriesPlaceholder') || '— 未设置 —'}</option>
                  {seriesList.map(s => <option key={s.id} value={s.name}>{s.name} ({s.count})</option>)}
                  {/* 2026-07-13 主人拍: 普通用户不显示 +新建 系列 */}
                  {isAdmin && <option value="__create__">{t('seriesCreateNew') || '+ 新建系列…'}</option>}
                </select>
              </div>
              {creatingSeries ? (
                <div className="product-info-dict-create">
                  <input
                    className="product-info-input is-short"
                    value={newSeriesName}
                    onChange={e => setNewSeriesName(e.target.value)}
                    placeholder={t('seriesNewPlaceholder') || '新系列名'}
                    autoFocus
                    disabled={dictBusy}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreateSeries(); if (e.key === 'Escape') { setCreatingSeries(false); setNewSeriesName(''); } }}
                  />
                  <button type="button" className="product-info-dict-create-btn" disabled={dictBusy || !newSeriesName.trim()} onClick={handleCreateSeries}>{t('confirm') || '确定'}</button>
                  <button type="button" className="product-info-dict-create-btn" disabled={dictBusy} onClick={() => { setCreatingSeries(false); setNewSeriesName(''); }}>{t('cancel') || '取消'}</button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="product-info-field">
            <span className="product-info-field-label">{t('name') || '产品名'}</span>
            <input className="product-info-input is-short" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="product-info-field">
            <span className="product-info-field-label">{t('spec') || '详细配置'}</span>
            <textarea className="product-info-input" rows={4} value={spec} onChange={e => setSpec(e.target.value)} />
          </div>
          <div className="product-info-field">
            <span className="product-info-field-label">{t('sellingPoints') || '产品卖点'}</span>
            <textarea className="product-info-input" rows={3} value={sellingPoints} onChange={e => setSellingPoints(e.target.value)} />
          </div>
          {/* 2026-07-06 18:50 主人拍: 售后 + 认证由 textarea 改为下拉选项 (售后 4 选项 / 认证 1 选项默认空) */}
          <div className="product-info-field-row">
            <div className="product-info-field">
              <span className="product-info-field-label">{t('afterSales') || '售后'}</span>
              <select
                className="product-info-input is-short"
                value={afterSales}
                onChange={e => setAfterSales(e.target.value)}
              >
                <option value="">{t('afterSalesPlaceholder') || '— 未设置 —'}</option>
                <option value="3年联保">{t('afterSalesOption1') || '3年联保'}</option>
                <option value="3年配件包换">{t('afterSalesOption2') || '3年配件包换'}</option>
                <option value="2年配件包换">{t('afterSalesOption3') || '2年配件包换'}</option>
                <option value="1年配件包换">{t('afterSalesOption4') || '1年配件包换'}</option>
              </select>
            </div>
            <div className="product-info-field">
              <span className="product-info-field-label">{t('certifications') || '认证'}</span>
              {/* 2026-07-06 18:50 主人拍: 默认留空, 现存 3C 认证保留 */}
              <select
                className="product-info-input is-short"
                value={certifications}
                onChange={e => setCertifications(e.target.value)}
              >
                <option value="">{t('certificationsPlaceholder') || '— 未设置 —'}</option>
                <option value="3C认证">{t('certificationsOption1') || '3C认证'}</option>
              </select>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="product-info-field-row">
            {renderReadonly(t('category') || '产品类别', product.category)}
            {renderReadonly(t('series') || '系列', product.series)}
          </div>
          {renderReadonly(t('name') || '产品名', product.name)}
          {renderReadonly(t('spec') || '详细配置', product.spec)}
          {renderReadonly(t('sellingPoints') || '产品卖点', product.selling_points)}
          <div className="product-info-field-row">
            {renderReadonly(t('afterSales') || '售后', product.after_sales)}
            {renderReadonly(t('certifications') || '认证', product.certifications)}
          </div>
        </>
      )}
    </div>
  );
}


// ── 右栏: 图片基础信息 (只读, 自动识别, 2026-07-04 21:51 主人拍) ──────────────────────
function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatRatio(w: number | null | undefined, h: number | null | undefined): string {
  if (!w || !h) return '—';
  // 常见比例表 (2026-07-05 08:15 主人拍: 约算到整数; 08:24 加约等于常见比)
  const commonRatios: Array<[string, number]> = [
    ['1:1', 1],
    ['16:9', 16 / 9],  // 1.7778
    ['9:16', 9 / 16],  // 0.5625
    ['4:3', 4 / 3],    // 1.3333
    ['3:4', 3 / 4],    // 0.75
    ['3:2', 3 / 2],    // 1.5
    ['2:3', 2 / 3],    // 0.6667
    ['8:5', 8 / 5],    // 1.6
    ['5:8', 5 / 8],    // 0.625
  ];
  // 阈值: 相对误差 ≤ 1% 视作匹配 (允许像素级抖动)
  const matchCommon = (ratio: number): string | null => {
    for (const [label, val] of commonRatios) {
      if (Math.abs(ratio - val) / val < 0.01) return label;
    }
    return null;
  };
  const ratio = w / h;
  const matched = matchCommon(ratio);
  if (matched) return matched;
  // 不匹配常见比 → GCD 整数约分
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(w, h);
  const rw = w / d;
  const rh = h / d;
  if (rw <= 50 && rh <= 50) return `${rw}:${rh}`;
  // 仍超长 (素数宽高) → 浮点 X:1 兜底
  return ratio >= 1
    ? `${ratio.toFixed(2)}:1`
    : `1:${(1 / ratio).toFixed(2)}`;
}

function formatFormat(path: string | null | undefined): string {
  if (!path) return '—';
  const m = path.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
  if (!m) return '—';
  return m[1].toUpperCase();
}

function ImageInfoGrid({ image, t }: { image: ProductImageRecord; t: Translator }) {
  const ratio = formatRatio(image.width, image.height);
  const pixels = (image.width && image.height) ? `${image.width} × ${image.height}` : '—';
  const size = formatFileSize(image.file_size_bytes);
  const fmt = formatFormat(image.original_path);
  return (
    <div className="product-modal-img-info" aria-label={t('imgInfo') || '图片信息'}>
      <div className="product-modal-img-info-cell">
        <span className="product-modal-img-info-label">{t('imgRatio') || '比例'}</span>
        <span className="product-modal-img-info-value">{ratio}</span>
      </div>
      <div className="product-modal-img-info-cell">
        <span className="product-modal-img-info-label">{t('imgSize') || '文件大小'}</span>
        <span className="product-modal-img-info-value">{size}</span>
      </div>
      <div className="product-modal-img-info-cell">
        <span className="product-modal-img-info-label">{t('imgPixels') || '像素'}</span>
        <span className="product-modal-img-info-value">{pixels}</span>
      </div>
      <div className="product-modal-img-info-cell">
        <span className="product-modal-img-info-label">{t('imgFormat') || '格式'}</span>
        <span className="product-modal-img-info-value">{fmt}</span>
      </div>
    </div>
  );
}


// ── 右栏: 当前选中图的提示词 (5 字段可编辑) ───────────────────────────────────────
function ProductPromptPanel({
  product,
  selectedImage,
  editing,
  onToggleEdit,
  onSaved,
  t,
  isAdmin = true,                  // 2026-07-13 主人拍: 普通用户只读, 不显示编辑/保存按钮
}: {
  product: ProductDetail;
  selectedImage: ProductImageRecord | null;
  editing: boolean;
  onToggleEdit: () => void;
  onSaved: (updated: ProductDetail) => void;
  t: Translator;
  isAdmin?: boolean;
}) {
  // 2026-07-06 16:42 主人拍重设计: 10 字段专业商品摄影 schema.
  // (展台 + 展台正面的 logo 独立, lighting 仅描述灯光)
  const [slogan, setSlogan] = useState('');
  const [subjectAngle, setSubjectAngle] = useState('');
  const [composition, setComposition] = useState('');
  const [lighting, setLighting] = useState('');
  const [displayStageAndLogo, setDisplayStageAndLogo] = useState('');
  const [materialTexture, setMaterialTexture] = useState('');
  const [background, setBackground] = useState('');
  const [style, setStyle] = useState('');
  const [colorTone, setColorTone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 选中图变化或 product 变化时同步
  useEffect(() => {
    setSlogan(selectedImage?.slogan ?? '');
    setSubjectAngle(selectedImage?.subject_angle ?? '');
    setComposition(selectedImage?.composition ?? '');
    setLighting(selectedImage?.lighting ?? '');
    setDisplayStageAndLogo(selectedImage?.display_stage_and_logo ?? '');
    setMaterialTexture(selectedImage?.material_texture ?? '');
    setBackground(selectedImage?.background ?? '');
    setStyle(selectedImage?.style ?? '');
    setColorTone(selectedImage?.color_tone ?? '');
    setError(null);
  }, [selectedImage?.id, selectedImage?.slogan, selectedImage?.subject_angle, selectedImage?.composition, selectedImage?.lighting, selectedImage?.display_stage_and_logo, selectedImage?.material_texture, selectedImage?.background, selectedImage?.style, selectedImage?.color_tone]);

  // 通用字数限制 helper
  const clip = (v: string, max: number) => v.length > max ? v.slice(0, max).trimEnd() : v;

  async function handleSave() {
    if (!selectedImage) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.products.updateImagePrompt(product.id, selectedImage.id, {
        slogan: clip(slogan, 20),
        subject_angle: clip(subjectAngle, 30),
        composition: clip(composition, 30),
        lighting: clip(lighting, 50),
        display_stage_and_logo: clip(displayStageAndLogo, 50),
        material_texture: clip(materialTexture, 30),
        background: clip(background, 30),
        style: clip(style, 30),
        color_tone: clip(colorTone, 30),
      });
      onSaved(updated);
      onToggleEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!selectedImage) {
    return (
      <div className="product-modal-col">
        <div className="product-modal-col-header">
          <span className="product-modal-col-title">{t('productPrompt') || '提示词'}</span>
        </div>
        <div className="product-prompt-readonly is-empty" style={{ minHeight: 120 }}>
          {t('selectImageForPrompt') || '先在下边选一张图'}
        </div>
      </div>
    );
  }

  return (
    <div className="product-modal-col">
      <div className="product-modal-col-header">
        <span className="product-modal-col-title">{t('productPrompt') || '提示词'} · #{selectedImage.id.slice(-6)}</span>
        <div className="product-modal-col-actions">
          {/* 2026-07-13 主人拍: 普通用户不显示编辑/保存/取消 按钮 */}
          {isAdmin && (!editing ? (
            <button type="button" className="product-modal-edit-toggle" onClick={onToggleEdit}>
              <Pencil size={11} /> {t('edit') || '编辑'}
            </button>
          ) : (
            <>
              <button type="button" className="product-modal-edit-toggle" onClick={onToggleEdit} disabled={busy}>
                {t('cancel') || '取消'}
              </button>
              <button type="button" className="product-modal-save-btn" onClick={handleSave} disabled={busy}>
                <Check size={11} /> {t('save') || '保存'}
              </button>
            </>
          ))}
        </div>
      </div>
      {/* 2026-07-04 21:51 主人拍: 图片基础信息 (只读, 自动识别) */}
      <ImageInfoGrid image={selectedImage} t={t} />
      {error ? <div className="error" role="alert">{error}</div> : null}
      {/* 2026-07-06 主人拍 8 字段专业商品摄影 schema */}
      {editing ? (
        <>
          {/* 1. slogan */}
          <div className="product-prompt-field">
            <span className="product-info-field-label">
              {t('promptSlogan') || '宣传标语'}
              <span className="product-prompt-counter">({slogan.length}/20)</span>
            </span>
            <textarea
              className="product-prompt-input"
              rows={2}
              maxLength={20}
              value={slogan}
              onChange={e => setSlogan(e.target.value.slice(0, 20))}
              placeholder="商品广告语 (8-20 字)"
            />
          </div>
          {/* 2. subject_angle */}
          <div className="product-prompt-field">
            <span className="product-info-field-label">
              {t('promptSubjectAngle') || '主体角度'}
              <span className="product-prompt-counter">({subjectAngle.length}/30)</span>
            </span>
            <textarea
              className="product-prompt-input"
              rows={2}
              maxLength={30}
              value={subjectAngle}
              onChange={e => setSubjectAngle(e.target.value.slice(0, 30))}
              placeholder="45° 斜上俯拍 / 正面平视 / 局部特写"
            />
          </div>
          {/* 3. composition */}
          <div className="product-prompt-field">
            <span className="product-info-field-label">
              {t('promptComposition') || '构图'}
              <span className="product-prompt-counter">({composition.length}/30)</span>
            </span>
            <textarea
              className="product-prompt-input"
              rows={2}
              maxLength={30}
              value={composition}
              onChange={e => setComposition(e.target.value.slice(0, 30))}
              placeholder="居中 / 三分法右下 / 满铺 / 含环境"
            />
          </div>
          {/* 4. lighting (仅灯光, 2026-07-06 16:42 主人拍净化, 不再含 logo) */}
          <div className="product-prompt-field product-prompt-field-emphasized">
            <span className="product-info-field-label">
              {t('promptLighting') || '灯光'}
              <span className="product-prompt-counter">({lighting.length}/50)</span>
            </span>
            <textarea
              className="product-prompt-input"
              rows={3}
              maxLength={50}
              value={lighting}
              onChange={e => setLighting(e.target.value.slice(0, 50))}
              placeholder="主光+辅光+质感 (不含 logo)"
            />
          </div>
          {/* 5. display_stage_and_logo (展台 + 展台正面 logo, 2026-07-06 17:19 主人拍 a: 合并) */}
          <div className="product-prompt-field product-prompt-field-emphasized">
            <span className="product-info-field-label">
              {t('promptDisplayStageAndLogo') || '展台及展台正面 logo'}
              <span className="product-prompt-counter">({displayStageAndLogo.length}/50)</span>
            </span>
            <textarea
              className="product-prompt-input"
              rows={3}
              maxLength={50}
              value={displayStageAndLogo}
              onChange={e => setDisplayStageAndLogo(e.target.value.slice(0, 50))}
              placeholder="木质展台 + 烫金 logo 正面居中"
            />
          </div>
          {/* 7. material_texture */}
          <div className="product-prompt-field">
            <span className="product-info-field-label">
              {t('promptMaterialTexture') || '材质触感'}
              <span className="product-prompt-counter">({materialTexture.length}/30)</span>
            </span>
            <textarea
              className="product-prompt-input"
              rows={2}
              maxLength={30}
              value={materialTexture}
              onChange={e => setMaterialTexture(e.target.value.slice(0, 30))}
              placeholder="哑光磨砂 / 抛光镜面 / 哑面金属拉丝"
            />
          </div>
          {/* 6. background */}
          <div className="product-prompt-field">
            <span className="product-info-field-label">
              {t('promptBackground') || '背景'}
              <span className="product-prompt-counter">({background.length}/30)</span>
            </span>
            <textarea
              className="product-prompt-input"
              rows={2}
              maxLength={30}
              value={background}
              onChange={e => setBackground(e.target.value.slice(0, 30))}
              placeholder="纯白抠图 / 暖灰渐变 / 室内实景"
            />
          </div>
          {/* 7. style */}
          <div className="product-prompt-field">
            <span className="product-info-field-label">
              {t('promptStyle') || '风格'}
              <span className="product-prompt-counter">({style.length}/30)</span>
            </span>
            <textarea
              className="product-prompt-input"
              rows={2}
              maxLength={30}
              value={style}
              onChange={e => setStyle(e.target.value.slice(0, 30))}
              placeholder="高端 / 极简 / 治愈系 / 工业风"
            />
          </div>
          {/* 8. color_tone */}
          <div className="product-prompt-field">
            <span className="product-info-field-label">
              {t('promptColorTone') || '色调'}
              <span className="product-prompt-counter">({colorTone.length}/30)</span>
            </span>
            <textarea
              className="product-prompt-input"
              rows={2}
              maxLength={30}
              value={colorTone}
              onChange={e => setColorTone(e.target.value.slice(0, 30))}
              placeholder="暖调奶油色 / 冷调银灰 / 高对比黑白"
            />
          </div>
        </>
      ) : (
        <>
          {/* readonly: 8 字段 */}
          <div className="product-prompt-field">
            <span className="product-info-field-label">{t('promptSlogan') || '宣传标语'}</span>
            <div className={`product-prompt-readonly${(selectedImage.slogan ?? '').trim() ? '' : ' is-empty'}`}>
              {(selectedImage.slogan ?? '').trim() || '—'}
            </div>
          </div>
          <div className="product-prompt-field">
            <span className="product-info-field-label">{t('promptSubjectAngle') || '主体角度'}</span>
            <div className={`product-prompt-readonly${(selectedImage.subject_angle ?? '').trim() ? '' : ' is-empty'}`}>
              {(selectedImage.subject_angle ?? '').trim() || '—'}
            </div>
          </div>
          <div className="product-prompt-field">
            <span className="product-info-field-label">{t('promptComposition') || '构图'}</span>
            <div className={`product-prompt-readonly${(selectedImage.composition ?? '').trim() ? '' : ' is-empty'}`}>
              {(selectedImage.composition ?? '').trim() || '—'}
            </div>
          </div>
          <div className="product-prompt-field product-prompt-field-emphasized">
            <span className="product-info-field-label">{t('promptLighting') || '灯光'}</span>
            <div className={`product-prompt-readonly${(selectedImage.lighting ?? '').trim() ? '' : ' is-empty'}`}>
              {(selectedImage.lighting ?? '').trim() || '—'}
            </div>
          </div>
          <div className="product-prompt-field">
            <span className="product-info-field-label">{t('promptDisplayStageAndLogo') || '展台及展台正面 logo'}</span>
            <div className={`product-prompt-readonly${(selectedImage.display_stage_and_logo ?? '').trim() ? '' : ' is-empty'}`}>
              {(selectedImage.display_stage_and_logo ?? '').trim() || '—'}
            </div>
          </div>
          <div className="product-prompt-field">
            <span className="product-info-field-label">{t('promptMaterialTexture') || '材质触感'}</span>
            <div className={`product-prompt-readonly${(selectedImage.material_texture ?? '').trim() ? '' : ' is-empty'}`}>
              {(selectedImage.material_texture ?? '').trim() || '—'}
            </div>
          </div>
          <div className="product-prompt-field">
            <span className="product-info-field-label">{t('promptBackground') || '背景'}</span>
            <div className={`product-prompt-readonly${(selectedImage.background ?? '').trim() ? '' : ' is-empty'}`}>
              {(selectedImage.background ?? '').trim() || '—'}
            </div>
          </div>
          <div className="product-prompt-field">
            <span className="product-info-field-label">{t('promptStyle') || '风格'}</span>
            <div className={`product-prompt-readonly${(selectedImage.style ?? '').trim() ? '' : ' is-empty'}`}>
              {(selectedImage.style ?? '').trim() || '—'}
            </div>
          </div>
          <div className="product-prompt-field">
            <span className="product-info-field-label">{t('promptColorTone') || '色调'}</span>
            <div className={`product-prompt-readonly${(selectedImage.color_tone ?? '').trim() ? '' : ' is-empty'}`}>
              {(selectedImage.color_tone ?? '').trim() || '—'}
            </div>
          </div>
        </>
      )}
    </div>
  );
}


// ── ProductModal: 重设计 2026-07-04, 上区三栏 + 下区缩略图集 + 上传区尾部 ────────────────
// 2026-07-05 09:27 主人拍: 新增产品默认进入信息编辑模式 (看到 Save 按键)
// 2026-07-05 09:35 主人拍: +Add 弹出 create 模式, 调 onCreateSubmit 才 POST /products
// 2026-07-05 09:56 主人拍 A 方案: +Delete product 按钮. onDeleted 回调通知 list refresh
function ProductModal({
  product,
  onClose,
  onUpdate,
  onDeleted,
  t,
  defaultInfoEditing = false,
  onCreateSubmit,
  initialSelectedImageId,
  imageCompressionEnabled,
  isAdmin = true,                  // 2026-07-13 主人拍: 普通用户只读, 隐藏所有 admin-only 按钮 (删除/上传/AI 反推/设封面/编辑信息/创建字典)
}: {
  product: ProductDetail;
  onClose: () => void;
  onUpdate: (p: ProductDetail) => void;
  onDeleted?: (productId: number) => void;
  t: Translator;
  defaultInfoEditing?: boolean;
  onCreateSubmit?: (fields: { name: string; series?: string; category?: string; spec?: string; selling_points?: string; after_sales?: string; certifications?: string }) => Promise<ProductDetail>;
  initialSelectedImageId?: string | null;
  imageCompressionEnabled: boolean;
  isAdmin?: boolean;
}) {
  const images = product.images || [];
  // 2026-07-10 主人拍: timeline 点缩略图时, ProductModal 中间大图 = 点中的那一张 (不是 cover).
  // initialSelectedImageId 传入时, 初始 selectedId 走它; 不传时 = 现状 (cover 优先 → 第一张).
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedImageId || null);
  // 同 product 多次打开 (从 timeline 点不同图) 时, sync selectedId 到最新 prop
  useEffect(() => {
    if (initialSelectedImageId && images.some(img => img.id === initialSelectedImageId)) {
      setSelectedId(initialSelectedImageId);
    }
  }, [initialSelectedImageId, images]);
  const [infoEditing, setInfoEditing] = useState(defaultInfoEditing);
  // 2026-07-05 09:27 主人拍: 新建产品 (activeProduct.id === newProductId) 之后 prod 入参变化时同步 infoEditing
  useEffect(() => {
    if (defaultInfoEditing && !infoEditing) setInfoEditing(true);
  }, [defaultInfoEditing]);
  const [promptEditing, setPromptEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  // 2026-07-06 19:12 主人拍: 大图脚下下载按钮 busy 状态
  const [downloading, setDownloading] = useState(false);

  // 2026-07-06 19:12 主人拍: 大图脚下下载按钮 → 拉原始图触发浏览器下载 (复用 copyImage 的 fetch blob 路径)
  // §58 复用: 跟 copyImage 一样走 fetch + blob, 不同点是不写 clipboard 而是 trigger <a download>
  async function handleDownload(img: ProductImageRecord) {
    if (downloading) return;
    const src = imageSrc(img, 'original') || imageSrc(img, 'preview') || imageSrc(img, 'thumb');
    if (!src) {
      setError('No image source available');
      return;
    }
    setDownloading(true);
    setError(null);
    try {
      const resp = await fetch(src, { credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const fileName = (img.original_path || '').split('/').pop() || `product-image-${img.id.slice(-6)}.png`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 延迟 revoke, 让 Safari/部分浏览器有机会起下载
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }
  // 2026-07-05 19:30 B 方案: 缩略图 ✨ 按钮的 AI 反推 busy 状态 (按 image_id 锁单个)
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  // 默认选中: cover 第一, 没有则第一张
  const effectiveSelectedId = useMemo(() => {
    if (selectedId && images.some(img => img.id === selectedId)) return selectedId;
    const cover = images.find(img => img.is_cover);
    return cover?.id || images[0]?.id || null;
  }, [selectedId, images]);
  const selectedImage = useMemo(
    () => images.find(img => img.id === effectiveSelectedId) || null,
    [effectiveSelectedId, images],
  );

  // 选中变化时把对应缩略图滚到中间
  useEffect(() => {
    if (!effectiveSelectedId || !stripRef.current) return;
    const node = stripRef.current.querySelector(`[data-thumb-id="${effectiveSelectedId}"]`) as HTMLElement | null;
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [effectiveSelectedId]);

  // ESC 关 modal
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // 滚轮在缩略图集上 = 左右切图 (默认 deltaY → horizontal scroll by mapping to next/prev)
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      // 仅当缩略图区有滚动需求时 (默认 native scroll 已 work), 不主动拦截; 但加方向键支持
    };
    strip.addEventListener('wheel', onWheel, { passive: true });
    return () => strip.removeEventListener('wheel', onWheel);
  }, []);

  // 方向键切图 (避免焦点在输入框时被吞)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (images.length === 0) return;
      event.preventDefault();
      const idx = images.findIndex(img => img.id === effectiveSelectedId);
      if (idx < 0) return;
      let next = idx;
      if (event.key === 'ArrowLeft') next = (idx - 1 + images.length) % images.length;
      else next = (idx + 1) % images.length;
      setSelectedId(images[next].id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [images, effectiveSelectedId]);

  async function uploadFiles(files: FileList | File[]) {
    const remaining = MAX_IMAGES_PER_PRODUCT - images.length;
    if (remaining <= 0) {
      setError(t('imageLimitReached') || `已达上限 ${MAX_IMAGES_PER_PRODUCT} 张`);
      return;
    }
    const arr = Array.from(files).slice(0, remaining);
    for (const file of arr) {
      setUploading(file.name);
      try {
        const updated = await api.products.uploadImage(product.id, file, imageCompressionEnabled);
        onUpdate(updated);
        // 自动选中新上传的图 (最后一张)
        const newImg = updated.images[updated.images.length - 1];
        if (newImg) {
          setSelectedId(newImg.id);
          setPromptEditing(true); // 提示用户编辑新图提示词
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setUploading(null);
  }

  async function handleSetCover(imageId: string) {
    setBusy(imageId);
    try {
      const updated = await api.products.setCover(product.id, imageId);
      onUpdate(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  }

  async function handleDelete(imageId: string) {
    if (!window.confirm(t('deleteConfirm'))) return;
    setBusy(imageId);
    try {
      const updated = await api.products.deleteImage(product.id, imageId);
      onUpdate(updated);
      // 删的就是当前选中的 → 选下一个/上一个
      if (effectiveSelectedId === imageId) {
        const newList = updated.images || [];
        setSelectedId(newList[0]?.id || null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  }

  // 2026-07-05 19:30 主人拍 B 方案: 缩略图 ✨ 按钮调 Codex vision 反推 5 字段
  // 2026-07-06 15:39 → 15:41 主人拍: 加重试到通用 client.ts; 此函数移除 retry 逻辑.
  // 503 (Codex 未认证) 仍“跳重试”提示主人走设置 (client.ts 中处理).
  async function handleAnalyzeImage(imageId: string) {
    setAnalyzing(imageId);
    setError(null);
    try {
      const result = await api.analyzeImage({ product_id: product.id, image_id: imageId, language: 'zh_hans' });
      // 2026-07-06 主人拍重设计: 8 字段判定是否识别到
      const hasAny = result.slogan || result.subject_angle || result.composition || result.lighting
                  || result.material_texture || result.background || result.style || result.color_tone;
      if (!hasAny) {
        setError('AI 未识别出 10 字段, 请检查 ⚙ 设置 → Codex 是否已认证, 或图片是否清晰');
        return;
      }
      // 把 10 字段 PATCH 到 product_image (联动 ProductPromptPanel useEffect 显示)
      const updated = await api.products.updateImagePrompt(product.id, imageId, {
        slogan: result.slogan ?? undefined,
        subject_angle: result.subject_angle ?? undefined,
        composition: result.composition ?? undefined,
        lighting: result.lighting ?? undefined,
        display_stage_and_logo: result.display_stage_and_logo ?? undefined,
        material_texture: result.material_texture ?? undefined,
        background: result.background ?? undefined,
        style: result.style ?? undefined,
        color_tone: result.color_tone ?? undefined,
      });
      onUpdate(updated);
      // 切到反推的那张图让主人立刻看到结果
      setSelectedId(imageId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 503 = LLM 未认证, 提示主人去 ⚙ 设置连接
      setError(/authenticate|not authenticated|503/i.test(msg) ? '请先到设置面板连接 AI (Codex OAuth)' : msg);
    } finally {
      setAnalyzing(null);
    }
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files.length > 0) uploadFiles(event.dataTransfer.files);
  }

  function handlePaste(event: React.ClipboardEvent) {
    const file = extractImageFromPasteEvent(event.nativeEvent);
    if (file) {
      event.preventDefault();
      uploadFiles([file]);
    }
  }

  // 2026-07-04 21:44 主人拍: 中间列大图右下角加复制按钮, 写 OS 剪贴板 (Clipboard API)
  // 微信 / 其它应用可直接 ⌘V 贴图, 不需走下载。
  async function copyImage(img: ProductImageRecord) {
    if (copyState === 'copying') return;
    const src = imageSrc(img, 'original') || imageSrc(img, 'preview') || imageSrc(img, 'thumb');
    if (!src) {
      setError('No image source available');
      return;
    }
    setCopyState('copying');
    setError(null);
    try {
      const resp = await fetch(src, { credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      // Clipboard API 需要 image/png, WebP 浏览器可能不支持. 若不是 png, 画到 canvas 转 png
      let outBlob: Blob = blob;
      if (blob.type && blob.type !== 'image/png') {
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas context unavailable');
        ctx.drawImage(bmp, 0, 0);
        outBlob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
        });
      }
      const ClipboardItemCtor = (window as any).ClipboardItem;
      if (!ClipboardItemCtor || !navigator.clipboard?.write) {
        throw new Error('Clipboard API not supported');
      }
      await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': outBlob })]);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 1800);
    }
  }

  const atLimit = images.length >= MAX_IMAGES_PER_PRODUCT;

  return (
    <div className="modal-backdrop product-modal-backdrop" onClick={onClose}>
      <div
        className="modal polished-modal product-modal"
        onClick={event => event.stopPropagation()}
        onPaste={handlePaste}
      >
        <div className="product-modal-body modal-content-enter product-modal-two-zone">
          {/* 顶部一行: 关闭 × + 类别胶囊 + 型号主标题 + meta (2026-07-04 21:42 主人拍: 同行) */}
          <div className="product-modal-model-header">
            <button className="modal-icon-button close" onClick={onClose} aria-label={t('close')} type="button">
              <X size={18} strokeWidth={2.25} />
            </button>
            {product.category ? (
              <span className="product-modal-model-category">{product.category}</span>
            ) : null}
            <h2 className="product-modal-model-title">{product.name}</h2>
            <span className="product-modal-model-meta">#{product.id} · source {product.source_id}</span>
            {/* 2026-07-05 09:56 主人拍 A 方案: 删除产品按钮 (仅查看模式, id>0). 2026-07-13 主人拍: 仅 admin 可见 */}
            {isAdmin && product.id > 0 && (
              <button
                type="button"
                className="product-modal-delete-btn"
                onClick={async () => {
                  if (!window.confirm(`确定删除产品 "${product.name}"? 该操作不可恢复 (包含所有图片).`)) return;
                  try {
                    await api.products.deleteProduct(product.id);
                    onDeleted?.(product.id);
                    onClose();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
                aria-label="删除产品"
                title="删除产品"
              >
                <Trash2 size={14} /> 删除
              </button>
            )}
          </div>
          {/* 上区: 左产品信息 / 中大图 / 右提示词 */}
          <div className="product-modal-upper-zone">
            <ProductInfoPanel
              product={product}
              editing={infoEditing}
              onToggleEdit={() => { setInfoEditing(v => !v); setError(null); }}
              onSaved={onUpdate}
              onCreateSubmit={onCreateSubmit}
              t={t}
              isAdmin={isAdmin}
            />
            <div className="product-modal-col" style={{ padding: 12 }}>
              <div className="product-modal-col-header">
                <span className="product-modal-col-title">{t('productImage') || '产品图'}</span>
                <span className="product-modal-col-actions" style={{ fontSize: 10, color: '#7a6c91' }}>
                  {selectedImage ? `#${selectedImage.id.slice(-6)}` : '—'}
                </span>
              </div>
              <div className="product-modal-main-image">
                {selectedImage ? (
                  <>
                    <img src={imageSrc(selectedImage, 'preview')} alt={product.name} />
                    {/* 2026-07-06 19:12 主人拍: 封面状态徽章走到大图内部 (原位于 caption 里), 替代 idx/n 数量 */}
                    {selectedImage.is_cover ? (
                      <span className="product-modal-main-image-caption">★ {t('coverBadge') || '封面'}</span>
                    ) : null}
                    {/* 2026-07-06 19:12 主人拍: 大图左下角删除按钮 (替代 idx/n 数量). 2026-07-13 主人拍: 仅 admin 可见 */}
                    {isAdmin && (
                    <button
                      type="button"
                      className="product-modal-main-image-delete"
                      disabled={busy === selectedImage.id}
                      title={t('deleteImage') || '删除图片'}
                      aria-label={t('deleteImage') || '删除图片'}
                      onClick={() => {
                        if (window.confirm(`确定删除图片 (${(images.findIndex(img => img.id === selectedImage.id) + 1)}/${images.length})? 该操作不可恢复。`)) handleDelete(selectedImage.id);
                      }}
                    >
                      <Trash2 size={20} strokeWidth={2} />
                    </button>
                    )}
                    {/* 2026-07-06 19:12 主人拍: 大图脚下 4 按钮容器 (设封面 / 反推 / 复制 / 下载) */}
                    <div className="product-modal-main-image-foot">
                      {/* 1. 设封面 — 仅非封面图可点; 已是封面者禁用. 2026-07-13 主人拍: 仅 admin 可见 */}
                      {isAdmin && (
                      <button
                        type="button"
                        className="product-modal-main-image-setcover"
                        disabled={busy === selectedImage.id || selectedImage.is_cover}
                        title={selectedImage.is_cover ? '当前已是封面' : (t('setCover') || '设置为封面')}
                        aria-label={t('setCover') || '设置为封面'}
                        onClick={() => handleSetCover(selectedImage.id)}
                      >
                        <Star size={20} fill={selectedImage.is_cover ? 'currentColor' : 'none'} strokeWidth={2} />
                      </button>
                      )}
                      {/* 2. AI 反推 — 2026-07-13 主人拍: 仅 admin 可见 */}
                      {isAdmin && (
                      <button
                        type="button"
                        className={`product-modal-main-image-ai${analyzing === selectedImage.id ? ' is-analyzing' : ''}`}
                        onClick={() => handleAnalyzeImage(selectedImage.id)}
                        aria-label="AI 反推 9 字段"
                        title="AI 反推 9 字段 (slogan / 主体角度 / 构图 / 灯光 / 展台logo / 材质 / 背景 / 风格 / 色调)"
                        disabled={!!analyzing}
                      >
                        {analyzing === selectedImage.id ? <Loader2 size={20} className="spin" /> : <Sparkles size={20} fill="currentColor" />}
                      </button>
                      )}
                      {/* 3. 复制 */}
                      <button
                        type="button"
                        className={`product-modal-main-image-copy${copyState === 'copied' ? ' is-copied' : ''}${copyState === 'error' ? ' is-error' : ''}`}
                        onClick={() => copyImage(selectedImage)}
                        aria-label={t('copyImage') || '复制图片'}
                        title={copyState === 'copied' ? (t('copied') || '已复制') : (t('copyImage') || '复制图片')}
                        disabled={copyState === 'copying'}
                      >
                        {copyState === 'copied' ? <Check size={20} /> : <Copy size={20} />}
                      </button>
                      {/* 4. 下载 (2026-07-06 19:12 主人拍: 反推右侧) */}
                      <button
                        type="button"
                        className="product-modal-main-image-download"
                        disabled={downloading}
                        title="下载原始图"
                        aria-label="下载原始图"
                        onClick={() => handleDownload(selectedImage)}
                      >
                        {downloading ? <Loader2 size={20} className="spin" /> : <Download size={20} />}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="product-modal-main-image-empty">
                    <ImageIcon size={36} />
                    <span>{t('noImagesPlaceholder')}</span>
                  </div>
                )}
              </div>
            </div>
            <ProductPromptPanel
              product={product}
              selectedImage={selectedImage}
              editing={promptEditing}
              onToggleEdit={() => { setPromptEditing(v => !v); setError(null); }}
              onSaved={onUpdate}
              t={t}
              isAdmin={isAdmin}
            />
          </div>

          {/* 下区: 缩略图集 + 上传区 (尾部) */}
          <div className="product-modal-lower-zone">
            <div className="product-modal-stats-row">
              <span>{t('productImages') || '图片'} <strong>{images.length}</strong> / {MAX_IMAGES_PER_PRODUCT}</span>
              {error ? <span style={{ color: '#c44' }}>{error}</span> : null}
              {uploading ? <span className="upload-row-status is-progress">{t('uploading') || '上传中…'} {uploading}</span> : null}
            </div>
            <div className="product-modal-thumbs-strip" ref={stripRef}>
              {images.map((img, idx) => (
                <div
                  key={img.id}
                  data-thumb-id={img.id}
                  className={`product-modal-thumb-item${img.id === effectiveSelectedId ? ' is-selected' : ''}`}
                  onClick={() => { setSelectedId(img.id); setPromptEditing(false); setInfoEditing(false); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(img.id); } }}
                >
                  <img src={imageSrc(img, 'thumb')} alt="" loading="lazy" />
                  {/* 2026-07-06 19:12 主人拍: 封面/删除 controls 全部迁移到中列大图, 缩略图仅保留选中状态 + 位置数字 */}
                  <span className="product-modal-thumb-position">{idx + 1}</span>
                  {img.is_cover ? (
                    <span className="product-modal-thumb-cover-mark" title={t('coverBadge') || '封面'}>
                      <Star size={9} fill="currentColor" />
                    </span>
                  ) : null}
                </div>
              ))}
              {/* 上传区放在尾部. 2026-07-13 主人拍: 仅 admin 可见. 普通用户没有上传权限. */}
              {isAdmin && (
              <div
                className={`product-modal-upload-slot${dragOver ? ' is-dragging' : ''}${atLimit ? ' is-disabled' : ''}`}
                onDragOver={e => { if (!atLimit) { e.preventDefault(); setDragOver(true); } }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.stopPropagation(); if (!atLimit) handleDrop(e); }}
                onClick={() => { if (!atLimit) fileInputRef.current?.click(); }}
                role="button"
                tabIndex={atLimit ? -1 : 0}
                aria-disabled={atLimit}
              >
                <Upload size={18} />
                <span>{atLimit ? (t('limitReached') || '已达上限') : (t('uploadImage') || '上传')}</span>
                {!atLimit ? <span className="product-modal-upload-slot-hint">{images.length}/{MAX_IMAGES_PER_PRODUCT}</span> : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={e => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ''; }}
                />
              </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function truncate(text: string | null | undefined, max: number): string {
  if (!text) return '';
  const normalized = text.trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max).trimEnd()}…`;
}


// ── ProductCard: 2026-07-05 20:43 主人拍完全重构 — 只显示产品标题 + 堆叠图.  系列/ID/spec/selling_points 全删. ─
function ProductCard({ product, onClick, q, t }: { product: ProductDetail; onClick: () => void; q?: string; t: Translator }) {
  const cover = product.cover_image || (product.images || []).find(img => img.is_cover);
  const allImages = (product.images || []);
  // 把封面图放到第一个位置，然后其他图
  const sortedImages = cover 
    ? [cover, ...allImages.filter(img => img.id !== cover.id)] 
    : allImages;
  const stackImages = sortedImages.slice(0, STACK_PREVIEW_COUNT);
  const overflow = (allImages.length) - STACK_PREVIEW_COUNT;
  const hasImages = stackImages.length > 0;

  return (
    <article
      className="product-card product-card-minimal"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {hasImages ? (
        <div className="product-card-cover">
          <div className="product-image-stack">
            {stackImages.map((img, i) => (
              <img
                key={img.id}
                src={imageSrc(img, 'thumb')}
                alt=""
                loading="lazy"
                className={`stack-img stack-img-${i + 1}${cover && img.id === cover.id ? ' is-cover' : ''}`}
              />
            ))}
          </div>
          {/* 2026-07-05 21:15 主人拍: 清除右上角 +N 稔章, 改为右下角总图片数量 */}
          <span className="product-card-count-total">{(product.images?.length) || 0}</span>
          {/* 2026-07-05 20:59 主人拍: 型号标题在堆叠图内部左上角 */}
          <h3 className="product-card-name product-card-name-overlay">{highlightText(product.name, q)}</h3>
        </div>
      ) : (
        <div className="product-card-cover product-card-cover-empty">
          <span className="product-card-empty-text">暂无图片</span>
          <h3 className="product-card-name product-card-name-overlay">{highlightText(product.name, q)}</h3>
        </div>
      )}
    </article>
  );
}


// 2026-07-10 主人拍: 瀑布流时间线视图.
// 数据流: products 展平为 [{product, image}], 按 effective_uploaded_at 倒序.  按 YYYY-MM 分组.  CSS columns 瀑布流.
// 兑底: effective_uploaded_at 为空时 (理论上不会出现) 兑底为 1970-01 末尾, 不丢图.
function ProductLibraryTimelineView({
  products,
  onOpenProduct,
  t,
}: {
  products: ProductDetail[];
  onOpenProduct: (p: ProductDetail, imageId: string) => void;
  t: Translator;
}) {
  // 2026-07-11 主人拍: timeline 模式不再受 globalThumbnailBudget 约束, 全部展开. 主人切到时间线想看全量.
  // 展平 + 排序 + 兑底
  const flat: { product: ProductDetail; image: ProductImageRecord; ts: string }[] = [];
  for (const product of products) {
    for (const image of (product.images || [])) {
      const ts = image.effective_uploaded_at || image.created_at || '1970-01-01T00:00:00+00:00';
      flat.push({ product, image, ts });
    }
  }
  flat.sort((a, b) => b.ts.localeCompare(a.ts));  // 倒序: 最新在上

  // 按 YYYY-MM 分组
  const groups = new Map<string, typeof flat>();
  for (const item of flat) {
    const month = item.ts.slice(0, 7);  // YYYY-MM
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month)!.push(item);
  }

  if (flat.length === 0) {
    return <div className="empty"><h2>{t('productLibraryEmpty') || '暂无产品'}</h2></div>;
  }

  return (
    <div className="product-timeline" aria-label={t('viewTimeline') || '时间线'}>
      {Array.from(groups.entries()).map(([month, items]) => (
        <section key={month} className="product-timeline-month">
          <header className="product-timeline-month-header">
            <h2 className="product-timeline-month-title">{month}</h2>
            <span className="product-timeline-month-count">{items.length} {t('imageCountShort')}</span>
          </header>
          <div className="product-timeline-masonry">
            {items.map(({ product, image }) => {
              // 2026-07-10 主人拍 修: thumb 真实尺寸是 PIL.thumbnail((420,420)) 后的尺寸, 不是原图.
              // product_images.width/height 存的是原图, 跟 thumb 比例不一致, 拿原图比例算 span 错.
              // 治本: 用 CSS aspect-ratio 原生浏览器布局, 原图比例 = 视觉比例 (PIL keep aspect ratio).
              const ratio = (image.width && image.height) ? `${image.width} / ${image.height}` : '1 / 1';
              return (
                <button
                  key={image.id}
                  type="button"
                  className="product-timeline-item"
                  onClick={() => onOpenProduct(product, image.id)}
                  title={product.name}
                  aria-label={`${product.name} ${image.id}`}
                >
                  <div className="product-timeline-img-wrap" style={{ aspectRatio: ratio }}>
                    <img
                      src={imageSrc(image, 'thumb')}
                      alt={product.name}
                      loading="lazy"
                      className="product-timeline-img"
                    />
                  </div>
                  <span className="product-timeline-item-name">{product.name}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}


// 2026-07-05 09:20 主人拍 A 方案: 加 newProductId prop, 告诉 view 刚创建的产品, 加载后自动打开 ProductModal
export default function ProductLibraryView({
  t,
  q,
  categoryId,
  seriesId,
  newProductId,
  onNewProductOpened,
  libraryView,
  onLibraryView,
  imageCompressionEnabled,
  globalThumbnailBudget,
  onProductsCountChange,            // 2026-07-12 主人拍: products 数量推回 TopBar
  onNewProductLoadError,            // 2026-07-12 主人拍: 加载新产品失败时通知顶层弹 toast
  authStatus,                        // 2026-07-12 主人拍: 守护 list 请求, 避免 401 闪烁
  isAdmin = true,                    // 2026-07-13 主人拍: 守护 admin-only 操作, 默认 true 保持单测/旧调用方兼容
  onClearSearch,                     // 2026-07-14 主人拍: 无匹配时点"清除筛选"按钮
  onClearCategoryFilter,             // 2026-07-14 主人拍: 清除品类/系列筛选
  onClearSeriesFilter,
}: {
  t: Translator;
  q?: string;
  categoryId?: number;
  seriesId?: number;
  newProductId?: number;
  onNewProductOpened?: () => void;
  libraryView: 'grid' | 'timeline';
  onLibraryView: (v: 'grid' | 'timeline') => void;
  imageCompressionEnabled: boolean;
  globalThumbnailBudget: number;
  onProductsCountChange?: (count: number) => void;
  onNewProductLoadError?: (message: string) => void;
  onClearSearch?: () => void;
  onClearCategoryFilter?: () => void;
  onClearSeriesFilter?: () => void;
  // 2026-07-12 主人拍: 'loading' | 'anonymous' | 'authenticated'. 用于守护 list 请求, 避免 401 闪烁.
  authStatus?: 'loading' | 'anonymous' | 'authenticated';
  // 2026-07-13 主人拍: 普通用户 (role='user') 不显示编辑/删除/上传/AI 反推/创建字典 等 admin-only 操作.
  // user 看到的 modal 是只读的: 不能新建, 不能改, 不能删, 不能上传图, 不能 AI 反推.
  isAdmin?: boolean;
}) {
  // 2026-07-11 主人拍: 把 config 里的 globalThumbnailBudget 接到瀑布流 (timeline masonry 张数 / grid 卡片数).
  // 列表用 ProductDetail (含 images 字段, 也兼容 4caf16a 的 spec/selling_points 字段)
  const [products, setProducts] = useState<ProductDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeProduct, setActiveProduct] = useState<ProductDetail | null>(null);
  // 2026-07-10 主人拍: libraryView 状态上移到 App.tsx 顶层, 跟导航栏 [网格|时间线] 按钮共享. 这里只读.
  // 2026-07-10 主人拍: timeline 点缩略图 → ProductModal 中间大图默认是点中的那一张.
  // null = 默认走 cover (现状). 设值后 ProductModal 初值变成它.
  const [initialSelectedImageId, setInitialSelectedImageId] = useState<string | null>(null);
  // 2026-07-10: onLibraryView 是导航栏接的 setter, 预留接口. 当前组件内部不调用 (页面内不再有切换按钮).
  void onLibraryView;

  // 2026-07-14 主人拍: 区分无匹配 vs 空库
  const hasActiveFilter = Boolean((q && q.trim()) || categoryId || seriesId);
  // 2026-07-12 主人拍: 仅在 authenticated 时拉产品. App.tsx 已守护条件渲染,
  // 这里再守一次, 防止 StrictMode / 上层误传导致初次挂载就触发 401.
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // 2026-07-12 主人拍: TopBar 搜索 + 品类/系列胶囊 → 透传到 /api/products
    api.products
      .list({ q, category_id: categoryId, series_id: seriesId } as never)
      .then(response => {
        if (cancelled) return;
        const items = response.items as unknown as ProductDetail[];
        setProducts(items);
        onProductsCountChange?.(items.length);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setProducts([]);
        onProductsCountChange?.(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, q, categoryId, seriesId]);

  // 2026-07-05 09:20 主人拍 A 方案: newProductId 设后, 主动 fetch 该产品 → 打开 ProductModal
  // 2026-07-05 09:27 修正: 不在此时通知 onNewProductOpened, 推迟到 modal 关闭时 (避免 defaultInfoEditing 翻转)
  // 2026-07-05 09:35 新增: newProductId=0 表示创建模式 → 用占位 ProductDetail + ProductModal 接 onCreateSubmit
  useEffect(() => {
    if (newProductId === undefined) return;
    let cancelled = false;
    if (newProductId === 0) {
      // 创建模式: 用占位 ProductDetail (id=-1 = DB 不存在), activeProduct 设进去, ProductModal 接 onCreateSubmit
      const placeholder: ProductDetail = {
        id: -1,
        source_id: 0,
        name: '',
        images: [],
      };
      setActiveProduct(placeholder);
      return () => { cancelled = true; };
    }
    api.products.get(newProductId).then(found => {
      if (cancelled) return;
      setActiveProduct(found);
    }).catch((err: unknown) => {
      // 2026-07-12 主人拍: 通知顶层 toast; console.error 留作开发可见.
      const msg = err instanceof Error ? err.message : String(err);
      onNewProductLoadError?.(msg);
      if (typeof console !== 'undefined') console.error('[ProductLibraryView] 加载新产品失败:', err);
    });
    return () => { cancelled = true; };
  }, [newProductId]);

  // 2026-07-14 主人拍: 加载失败时给一个温和的友好提示 + 重试按钮, 不再裸贴 error 文本.
  if (loading) {
    return <div className="loading" role="status">{t('loading')}</div>;
  }
  const loadRetry = () => {
    // 重新触发 useEffect: 改 q/categoryId/seriesId 之一即可. 这里直接 reloadProducts 用的
    // state 没暴露, 用一个微小的依赖抖动: 触发同 useEffect 的副作用 (让 parent 重置一次).
    setError(null);
    setLoading(true);
    api.products
      .list({ q, category_id: categoryId, series_id: seriesId } as never)
      .then(response => {
        const items = (response as { items: ProductDetail[] }).items;
        setProducts(items);
        onProductsCountChange?.(items.length);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setProducts([]);
        onProductsCountChange?.(0);
      })
      .finally(() => setLoading(false));
  };
  if (error) {
    return (
      <div className="empty" role="alert">
        <h2>{t('productLibraryLoadFailed')}</h2>
        <div className="empty-actions">
          <button type="button" className="empty-primary" onClick={loadRetry}>
            {t('productLibraryRetry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {products.length === 0 && !loading ? (
        // 2026-07-14 主人拍: 区分"无匹配结果"和"产品库为空". 加载失败另外处理 (见上 .error).
        // 无搜索/筛选条件时显示空库提示; 有条件时显示"无匹配"并提供清除按钮.
        <div className="empty">
          <h2>{hasActiveFilter ? t('productLibraryNoResults') : t('productLibraryEmpty')}</h2>
          <p>{hasActiveFilter ? t('productLibraryNoResultsHelp') : t('productLibraryEmptyHelp')}</p>
          {hasActiveFilter ? (
            <div className="empty-actions">
              <button
                type="button"
                className="empty-primary"
                onClick={() => {
                  onClearSearch?.();
                  onClearCategoryFilter?.();
                  onClearSeriesFilter?.();
                }}
              >
                {t('productLibraryClearFilters')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {libraryView === 'grid' ? (
        <section
          className="product-library-grid"
          aria-label={t('product_library')}
          style={{ ['--product-cols' as string]: String(globalThumbnailBudget) }}
        >
          {products.map(product => (
            <ProductCard
              key={product.id}
              product={product}
              onClick={() => setActiveProduct(product)}
              q={q}
              t={t}
            />
          ))}
        </section>
      ) : (
        // 2026-07-10 主人拍: 瀑布流时间线. 按 effective_uploaded_at YYYY-MM 分组 + 倒序. 30 行 CSS columns.
        <ProductLibraryTimelineView
          products={products}
          onOpenProduct={(p, imageId) => { setActiveProduct(p); setInitialSelectedImageId(imageId); }}
          t={t}
        />
      )}
      {activeProduct ? (
        <ProductModal
          product={activeProduct}
          // 2026-07-10 主人拍: timeline 点缩略图 → 中间大图 = 点中的那一张 (不跳到 cover)
          initialSelectedImageId={initialSelectedImageId}
          // 2026-07-10 11:03 主人拍: 压缩开关. 传到 ProductModal 给 uploadFiles 用.
          imageCompressionEnabled={imageCompressionEnabled}
          // 2026-07-13 主人拍: 普通用户不进入编辑模式, 不显示 admin-only 按钮.
          isAdmin={isAdmin}
          // 2026-07-05 09:27 主人拍: 新建产品默认进入编辑模式 (Save 按键可见). 普通用户永远不进入编辑模式.
          defaultInfoEditing={isAdmin && (activeProduct.id === -1 || activeProduct.id === newProductId)}
          // 2026-07-05 09:56 主人拍 A 方案: 删除产品回调
          onDeleted={(productId) => {
            setActiveProduct(null);
            setProducts(prev => prev.filter(p => p.id !== productId));
          }}
          // 2026-07-13 主人拍: 普通用户不传 onCreateSubmit, 阻断 +Add 触发的创建流程 (App.tsx 也不会给 user 触发)
          onCreateSubmit={isAdmin && activeProduct.id === -1 ? async (fields) => {
            const res = await fetch('/api/v1/products', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(fields),
            });
            if (!res.ok) {
              const detail = (await res.json().catch(() => ({}))).detail || `HTTP ${res.status}`;
              throw new Error(detail);
            }
            const created = await res.json();
            // 创建成功后: 切到刚创建的 product + 更新列表 + reset newProductId (不立刻, 推迟到 modal 关)
            setActiveProduct(created);
            setProducts(prev => [...prev, created]);
            return created;
          } : undefined}
          onClose={() => {
            setActiveProduct(null);
            // 2026-07-10 主人拍: 关 modal 时重置 initialSelectedImageId, 下次点 grid 卡片不会被 timeline 残留选中
            setInitialSelectedImageId(null);
            // 关掉 modal 才让 App 清理 newProductId (避免渲染期间 defaultInfoEditing 翻转)
            if (activeProduct.id === -1 || activeProduct.id === newProductId) onNewProductOpened?.();
          }}
          onUpdate={updated => {
            setActiveProduct(updated);
            setProducts(prev => prev.map(p => (p.id === updated.id ? updated : p)));
            // 2026-07-05 09:35: 创建模式下, 新创建的 product id 给 App 记住, 后续可刷新
            if (activeProduct.id === -1 && updated.id > 0) {
              // 不复位 newProductId, 让 defaultInfoEditing 转为 false (进入查看模式), 用户可上传图
            }
          }}
          t={t}
        />
      ) : null}
    </>
  );
}
