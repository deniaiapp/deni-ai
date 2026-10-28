import { createFileRoute } from "@tanstack/react-router";
import { getExtracted } from "@/i18n/extracted";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/{-$locale}/legal/tokusho")({
  head: ({ match }) => {
    const { intl } = match.context;
    const t = getExtracted(intl);
    const head = pageHead({
      title: t("特定商取引法に基づく表記"),
      description: t("特定商取引法に基づく表記です。"),
      robots: { index: false, follow: false },
    });
    return { ...head, meta: [...head.meta, { name: "googlebot", content: "noindex, nofollow" }] };
  },
  component: TokushoPage,
});

const items = [
  { label: "事業者名", value: "請求があった場合には遅滞なく開示いたします" },
  { label: "運営責任者", value: "桃木 悠汰" },
  { label: "所在地", value: "請求があった場合には速やかに開示いたします" },
  { label: "電話番号", value: "請求があった場合には速やかに開示いたします" },
  { label: "メールアドレス", value: "contact@deniai.app" },
  { label: "販売価格", value: "各商品ページに記載の金額（税込）" },
  { label: "支払方法", value: "クレジットカード" },
  { label: "支払時期", value: "クレジットカード決済は即時処理されます" },
  { label: "商品の引渡時期", value: "決済完了後、即時利用可能" },
  {
    label: "返品・キャンセル",
    value: "デジタルサービスの性質上、原則として返品・返金には対応しておりません",
  },
  { label: "商品代金以外の費用", value: "なし" },
];

function TokushoPage() {
  return (
    <main className="min-h-screen bg-background" id="main-content">
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-28 sm:px-6">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">特定商取引法に基づく表記</h1>
          <p className="mt-2 text-sm text-muted-foreground">最終更新日: 2025年12月31日</p>
        </div>

        <table className="w-full border-collapse text-sm">
          <tbody>
            {items.map((item) => (
              <tr key={item.label} className="border-b border-border">
                <th className="w-1/3 bg-muted/50 px-4 py-3 text-left font-medium align-top">
                  {item.label}
                </th>
                <td className="px-4 py-3 text-muted-foreground">{item.value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-8 text-xs text-muted-foreground">
          ※ 上記の「請求があった場合には開示」の項目については、メールにてお問い合わせください。
        </p>
      </div>
    </main>
  );
}
