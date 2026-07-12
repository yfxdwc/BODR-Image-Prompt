import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, FilePlus2, Loader2, Pencil, Wand2, X } from 'lucide-react';
import { api } from '../api/client';
import type { ItemDetail, Product, PromptRecord } from '../types';
import type { Translator } from '../utils/i18n';
import { copyTextToClipboard } from '../utils/clipboard';
import { detectFormatIssues } from '../utils/promptPolish';

interface PromptComposerProps {
  item: ItemDetail;
  currentPrompt: PromptRecord | undefined;
  promptLanguage: string;
  t: Translator;
  onCommitted?: () => void;
  onPromptCopied: (success: boolean) => void;
}

interface ComposerToast {
  message: string;
  tone: 'success' | 'error';
}

const PROMPT_LANGUAGE_LABELS: Record<string, string> = {
  zh_hans: '简中',
  zh_hant: '繁中',
  en: 'ENG',
};

function buildComposedPrompt(args: {
  baseText: string;
  product: Product | null;
  notes: string;
}): string {
  const { baseText, product, notes } = args;
  const blocks: string[] = [];
  if (baseText.trim()) blocks.push(baseText.trim());
  if (product) {
    const productLines: string[] = [];
    if (product.series) productLines.push(`系列：${product.series}`);
    productLines.push(`型号：${product.name}`);
    if (product.spec && product.spec.trim()) productLines.push(`规格：${product.spec.trim()}`);
    if (product.selling_points && product.selling_points.trim()) productLines.push(`卖点：${product.selling_points.trim()}`);
    blocks.push(`【产品型号】\n${productLines.join('\n')}`);
  }
  if (notes.trim()) {
    blocks.push(`【附加备注】\n${notes.trim()}`);
  }
  return blocks.join('\n\n');
}

export default function PromptComposer({
  item,
  currentPrompt,
  promptLanguage,
  t,
  onCommitted,
  onPromptCopied,
}: PromptComposerProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productError, setProductError] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [busy, setBusy] = useState<null | 'copy' | 'create' | 'edit'>(null);
  const [toast, setToast] = useState<ComposerToast | undefined>();
  const [editingComposed, setEditingComposed] = useState(false);
  const [composedDraft, setComposedDraft] = useState('');
  const [polishedComposed, setPolishedComposed] = useState<string | null>(null);
  const [polishError, setPolishError] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [polishApplied, setPolishApplied] = useState(false);

  // item.id 变化时重置 polish 状态
  const lastItemIdRef = useRef(item.id);
  useEffect(() => {
    if (lastItemIdRef.current !== item.id) {
      lastItemIdRef.current = item.id;
      setPolishedComposed(null);
      setPolishApplied(false);
      setPolishError(null);
      setPolishing(false);
      setSelectedProductId('');
      setNotes('');
    }
  }, [item.id]);

  useEffect(() => {
    let alive = true;
    setLoadingProducts(true);
    setProductError(null);
    api.products
      .list()
      .then(result => {
        if (!alive) return;
        setProducts(result.items);
      })
      .catch(error => {
        if (!alive) return;
        setProductError(error instanceof Error ? error.message : 'Failed to load products');
      })
      .finally(() => {
        if (alive) setLoadingProducts(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = window.setTimeout(() => setToast(undefined), 2600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [toast]);

  // 检测编辑模式：编辑时不要自动 polish（避免覆盖用户修改）
  useEffect(() => {
    if (editingComposed) {
      setPolishedComposed(null);
      setPolishApplied(false);
    }
  }, [editingComposed]);

  const selectedProduct = useMemo(
    () => products.find(product => String(product.id) === selectedProductId) || null,
    [products, selectedProductId],
  );

  const composed = useMemo(
    () => buildComposedPrompt({ baseText: currentPrompt?.text || '', product: selectedProduct, notes }),
    [currentPrompt?.text, selectedProduct, notes],
  );

  // 检测格式问题
  const formatIssues = useMemo(() => detectFormatIssues(composed), [composed]);
  const hasFormatIssues = formatIssues.length > 0;

  // 决定预览区显示：编辑中用 draft, 否则用 polished（如果有）或 composed
  const displayedComposed = editingComposed ? composedDraft : (polishedComposed ?? composed);
  const isPolished = !editingComposed && polishedComposed != null && polishedComposed === displayedComposed;

  // 当 composed 或 promptLanguage 变化，且存在格式问题时，自动调 LLM 优化
  useEffect(() => {
    // 编辑模式不调
    if (editingComposed) return;
    // 没有产品或没有内容不调 (此时 composed 为空或仅有 base text)
    if (!composed.trim() || !selectedProduct) {
      setPolishedComposed(null);
      setPolishApplied(false);
      setPolishError(null);
      return;
    }
    // 不需要 polish
    if (!hasFormatIssues) {
      setPolishedComposed(null);
      setPolishApplied(false);
      setPolishError(null);
      return;
    }
    // debounce 200ms
    const timer = window.setTimeout(async () => {
      let cancelled = false;
      setPolishing(true);
      setPolishError(null);
      try {
        const result = await api.polishPrompt({ text: composed, language: promptLanguage || undefined });
        if (cancelled) return;
        if (result.changed && result.text && result.text.trim()) {
          setPolishedComposed(result.text);
          setPolishApplied(true);
        } else {
          setPolishedComposed(null);
          setPolishApplied(false);
        }
      } catch (err) {
        if (cancelled) return;
        setPolishError(err instanceof Error ? err.message : 'LLM 优化失败');
        setPolishedComposed(null);
      } finally {
        if (!cancelled) setPolishing(false);
      }
      return () => { cancelled = true; };
    }, 220);
    return () => window.clearTimeout(timer);
  }, [composed, hasFormatIssues, promptLanguage, editingComposed]);

  const hasProduct = Boolean(selectedProduct);
  const composedHasContent = composed.trim().length > 0;
  const canCompose = hasProduct && composedHasContent;

  const flashToast = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
  };

  const handleCopy = async () => {
    if (!canCompose) return;
    setBusy('copy');
    try {
      const ok = await copyTextToClipboard(composed);
      onPromptCopied(ok);
      flashToast(ok ? '组合提示词已复制到剪贴板' : '复制失败，请重试', ok ? 'success' : 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleStartEditComposed = () => {
    if (!canCompose || !currentPrompt) return;
    setComposedDraft(polishedComposed || composed);
    setEditingComposed(true);
  };

  const handleCancelEditComposed = () => {
    setEditingComposed(false);
    setComposedDraft('');
  };

  const handleConfirmEditComposed = async () => {
    if (!editingComposed || !currentPrompt) return;
    const nextText = composedDraft.trim();
    if (!nextText) {
      flashToast('组合结果不能为空', 'error');
      return;
    }
    setBusy('edit');
    try {
      const merged = new Map(item.prompts.map(existing => [existing.language, existing.text]));
      merged.set(currentPrompt.language, nextText);
      const orderedLanguages = ['zh_hans', 'zh_hant', 'en'];
      const orderedPromptTexts = orderedLanguages
        .map(language => ({ language, text: merged.get(language)?.trim() || '' }))
        .filter(entry => entry.text);
      const primaryLanguage = orderedPromptTexts[0]?.language;
      await api.updateItem(item.id, {
        prompts: orderedPromptTexts.map(entry => ({
          language: entry.language,
          text: entry.text,
          is_primary: entry.language === primaryLanguage,
        })),
      });
      flashToast('已覆盖当前提示词');
      setEditingComposed(false);
      setComposedDraft('');
      onCommitted?.();
    } catch (error) {
      flashToast(error instanceof Error ? `保存失败：${error.message}` : '保存失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleCreateNewItem = async () => {
    if (!canCompose) return;
    setBusy('create');
    try {
      const titleBase = item.title || '新组合';
      const title = `${titleBase} · ${selectedProduct?.name || ''}`.trim();
      const clusterName = item.cluster?.name || undefined;
      const tagNames = item.tags.map(tag => tag.name);
      // 使用 polish 后的文本（如果有），否则用原始组合结果
      const finalText = polishedComposed || composed;
      const prompts = [
        {
          language: promptLanguage || 'zh_hans',
          text: finalText,
          is_primary: true,
          is_original: true,
        },
      ];
      await api.createItem({
        title,
        cluster_name: clusterName,
        tags: tagNames,
        prompts,
        notes: notes.trim() || undefined,
      });
      flashToast('已创建新卡片');
      onCommitted?.();
    } catch (error) {
      flashToast(error instanceof Error ? `创建失败：${error.message}` : '创建失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const languageLabel = PROMPT_LANGUAGE_LABELS[promptLanguage] || promptLanguage;
  const hasOriginalPrompt = Boolean(currentPrompt?.text?.trim());

  return (
    <aside className="detail-composer">
      <div className="detail-composer-header">
        <span className="detail-composer-kicker">
          <Wand2 size={14} strokeWidth={2.25} />
          组合提示词
        </span>
        <span className="detail-composer-language-chip">{languageLabel}</span>
      </div>

      <label className="detail-composer-field">
        <span className="detail-composer-label">产品型号 <em>*</em></span>
        <select
          className="detail-composer-select"
          value={selectedProductId}
          onChange={event => setSelectedProductId(event.target.value)}
          disabled={loadingProducts || busy !== null}
        >
          <option value="">{loadingProducts ? '加载中…' : '请选择产品型号'}</option>
          {products.map(product => (
            <option key={product.id} value={String(product.id)}>
              {product.series ? `${product.series} · ` : ''}{product.name}
            </option>
          ))}
        </select>
        {productError && <span className="detail-composer-error">{productError}</span>}
        {!hasProduct && !productError && (
          <span className="detail-composer-hint">从产品库中挑选要植入的产品型号</span>
        )}
      </label>

      <label className="detail-composer-field detail-composer-notes">
        <span className="detail-composer-label">附加备注 <em>可选</em></span>
        <textarea
          className="detail-composer-textarea"
          value={notes}
          onChange={event => setNotes(event.target.value)}
          placeholder="例如：保持原图构图，强调产品的金属质感与暖光氛围"
          rows={4}
          disabled={busy !== null}
        />
      </label>

      <section className="prompt-block prompt-panel detail-composer-preview">
        <header className="prompt-block-header">
          <div className="prompt-language-tabs tabs detail-composer-tabs" role="tablist" aria-label="组合预览">
            <button
              type="button"
              role="tab"
              aria-selected="true"
              className="prompt-language-tab active is-original detail-composer-title"
              title="LLM 优化预览框"
            >
              组合预览
              {(polishing || polishApplied || polishError || (hasFormatIssues && composed.trim())) && (
                <span className={`detail-composer-polish-indicator ${polishing ? '' : polishApplied && isPolished ? 'is-applied' : polishError ? 'is-error' : hasFormatIssues ? 'is-pending' : ''}`}>
                  {polishing && (<><Loader2 size={11} className="spin" /> 优化中</>)}
                  {!polishing && polishApplied && isPolished && (<><Wand2 size={11} /> 已优化</>)}
                  {!polishing && polishError && (<><X size={11} /> 优化失败</>)}
                  {!polishing && hasFormatIssues && !polishApplied && !polishError && composed.trim() && (<><Wand2 size={11} /> {formatIssues.length} 个问题</>)}
                </span>
              )}
            </button>
          </div>
          <span className="prompt-block-actions">
            <span className="detail-composer-count">{displayedComposed.length} 字</span>
            {editingComposed ? (
              <>
                <button
                  type="button"
                  className="inline-edit-confirm"
                  onClick={handleConfirmEditComposed}
                  aria-label="保存修改"
                  disabled={busy !== null}
                >
                  <Check size={14} />
                </button>
                <button
                  type="button"
                  className="inline-edit-cancel"
                  onClick={handleCancelEditComposed}
                  aria-label="取消修改"
                  disabled={busy !== null}
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="prompt-edit-icon"
                  onClick={handleStartEditComposed}
                  aria-label="修改组合结果"
                  disabled={!canCompose || !currentPrompt?.text?.trim() || busy !== null}
                  title={!currentPrompt?.text?.trim() ? '当前提示词为空时不可修改' : '修改组合结果'}
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  className="prompt-copy-icon"
                  onClick={handleCopy}
                  aria-label="复制组合结果"
                  disabled={!canCompose || busy !== null}
                  title="复制组合结果"
                >
                  <Copy size={15} />
                </button>
              </>
            )}
          </span>
        </header>
        <div className="prompt-panel-body">
          {editingComposed ? (
            <textarea
              className="prompt-edit-textarea detail-composer-edit-textarea"
              value={composedDraft}
              autoFocus
              onChange={event => setComposedDraft(event.target.value)}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') handleConfirmEditComposed();
                if (event.key === 'Escape') handleCancelEditComposed();
              }}
            />
          ) : (
            <div className="prompt-inline-edit detail-composer-preview-body">
              {displayedComposed ? <p>{displayedComposed}</p> : <span className="add-note-affordance">选择产品后显示组合结果…</span>}
            </div>
          )}
        </div>
      </section>

      <div className="detail-composer-actions">
        <button
          type="button"
          className="secondary detail-composer-button primary"
          onClick={handleCreateNewItem}
          disabled={!canCompose || busy !== null}
        >
          <FilePlus2 size={15} strokeWidth={2.25} />
          {busy === 'create' ? '创建中…' : '创建为新卡片'}
        </button>
      </div>

      {toast && (
        <div className={`detail-composer-toast ${toast.tone === 'error' ? 'is-error' : ''}`} role="status">
          {toast.tone === 'success' ? <Check size={14} /> : <X size={14} />}
          <span>{toast.message}</span>
        </div>
      )}

      {!hasOriginalPrompt && (
        <p className="detail-composer-hint">
          <X size={12} /> 当前语言暂无提示词内容，组合预览将以空基础开始。
        </p>
      )}
    </aside>
  );
}
