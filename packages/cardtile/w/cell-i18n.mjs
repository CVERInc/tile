// What each KIND OF TILE is called, and what its fields ask for — in the console's nine locales.
//
// 🩸 WHY THIS FILE EXISTS. Every one of these strings used to be a Traditional Chinese literal in
// `ai-ops.mjs`, printed verbatim by `paintPalette()` and the cell sheet. So a Japanese visitor to
// card.feelreef.com/try/edit read 「ブロックを追加」 and then, underneath it, seven Chinese words —
// and every field label and every hint in every form, in Chinese, in all nine locales. Measured on
// 2026-09-06 across zh-TW / ja / en: the chrome was translated, the product was not.
//
// 🩸 AND THEY WERE NOT WRITTEN FOR A PERSON. 「整列寬(w=6)時會和相鄰的連結列併成同一塊」,
// 「名字來自 frontmatter 的 title」, 「一排 40px 的圖示」, 「`slider` 是常見的那種」. Those are notes
// an engineer leaves for themselves. The house threshold is 「連膝蓋都不用抬」 — a first-time
// visitor in their fifties, who has never heard of frontmatter and should never need to.
//
// ── SHAPE: KEY FIRST, LOCALE SECOND ─────────────────────────────────────────────────────────────
//
// 🔴 A DELIBERATE DEPARTURE from `CHROME_STRINGS` next door, which is locale-first. That shape is
// right for a table someone reads one locale at a time; it is wrong for this one. Adding a field to
// a form means touching nine separate blocks, and the ninth is the one that gets forgotten — which
// is exactly the drift this file was created to end. Key first puts all nine translations of one
// question on adjacent lines, so a missing one is visible rather than deducible.
//
// `cellStrings(locale)` flattens it back to a plain `key → string` table, so nothing downstream has
// to know or care which way round it is stored.
//
// 🔴 EVERY KEY IN EVERY LOCALE, OR IT DOES NOT SHIP. `sandbox-cells.test.mjs` asserts that, plus a
// ban list (no backticks, no `w=6`, no frontmatter, no favicon, no sha256, no px, no CTA) over every
// string here — the review's own §3.1.4 ruler, applied to all nine rather than to the one someone
// happened to be reading.

/** locale key → its strings. The same nine `sandbox-i18n.mjs` speaks; that file's list is the SSOT. */
export const CELL_STRINGS_BY_KEY = {
  // ── the profile tile ───────────────────────────────────────────────────────────────────────────
  'type.profile.title': {
    zh: '個人檔案', ja: 'プロフィール', en: 'Profile', ko: '프로필', 'zh-Hans': '个人档案',
    de: 'Profil', fr: 'Profil', es: 'Perfil', pt: 'Perfil',
  },
  'type.profile.hint': {
    zh: '卡片最上面：大頭貼、名字、一句話。',
    ja: 'カードの一番上：写真、名前、ひとこと。',
    en: 'The top of the card: photo, name, one line.',
    ko: '카드 맨 위：사진, 이름, 한 줄.',
    'zh-Hans': '卡片最上面：头像、名字、一句话。',
    de: 'Der Kopf der Karte: Foto, Name, eine Zeile.',
    fr: 'Le haut de la carte : photo, nom, une ligne.',
    es: 'La parte de arriba de la tarjeta: foto, nombre, una línea.',
    pt: 'O topo do cartão: foto, nome, uma linha.',
  },
  'type.profile.name.label': {
    zh: '名字', ja: '名前', en: 'Name', ko: '이름', 'zh-Hans': '名字',
    de: 'Name', fr: 'Nom', es: 'Nombre', pt: 'Nome',
  },
  'type.profile.body.label': {
    zh: '一句話介紹', ja: 'ひとこと', en: 'One line about you', ko: '한 줄 소개',
    'zh-Hans': '一句话介绍', de: 'Eine Zeile über Sie', fr: 'Une ligne sur vous',
    es: 'Una línea sobre ti', pt: 'Uma linha sobre você',
  },
  'type.profile.avatar.label': {
    zh: '大頭貼', ja: 'プロフィール写真', en: 'Photo', ko: '프로필 사진', 'zh-Hans': '头像',
    de: 'Foto', fr: 'Photo', es: 'Foto', pt: 'Foto',
  },
  'type.profile.chips.label': {
    zh: '標籤（選填）', ja: 'タグ（任意）', en: 'Tags (optional)', ko: '태그（선택）',
    'zh-Hans': '标签（选填）', de: 'Schlagwörter (optional)', fr: 'Étiquettes (facultatif)',
    es: 'Etiquetas (opcional)', pt: 'Etiquetas (opcional)',
  },
  'type.profile.chips.hint': {
    zh: '用逗號分開，例如「插畫家, 台北」。',
    ja: 'カンマで区切ります（例：イラストレーター, 台北）。',
    en: 'Separate with commas, e.g. "Illustrator, Taipei".',
    ko: '쉼표로 구분해 주세요（예：일러스트레이터, 타이베이）.',
    'zh-Hans': '用逗号分开，例如「插画家, 台北」。',
    de: 'Mit Kommas trennen, z. B. „Illustratorin, Taipeh“.',
    fr: 'Séparez par des virgules, par exemple « Illustratrice, Taipei ».',
    es: 'Sepáralas con comas, por ejemplo «Ilustradora, Taipéi».',
    pt: 'Separe com vírgulas, por exemplo “Ilustradora, Taipé”.',
  },

  // ── the link tile ──────────────────────────────────────────────────────────────────────────────
  'type.link.title': {
    zh: '連結', ja: 'リンク', en: 'Link', ko: '링크', 'zh-Hans': '链接',
    de: 'Link', fr: 'Lien', es: 'Enlace', pt: 'Link',
  },
  'type.link.hint': {
    zh: '一顆帶圖示的按鈕，點了去你指定的網址。',
    ja: 'アイコン付きのボタン。押すと指定した URL へ。',
    en: 'A button with an icon that opens the address you choose.',
    ko: '아이콘이 있는 버튼. 누르면 지정한 주소로 이동해요.',
    'zh-Hans': '一颗带图标的按钮，点了去你指定的网址。',
    de: 'Eine Schaltfläche mit Symbol, die die Adresse Ihrer Wahl öffnet.',
    fr: 'Un bouton avec une icône qui ouvre l’adresse de votre choix.',
    es: 'Un botón con icono que abre la dirección que elijas.',
    pt: 'Um botão com ícone que abre o endereço que você escolher.',
  },
  'type.link.text.label': {
    zh: '按鈕上的字', ja: 'ボタンの文字', en: 'Button text', ko: '버튼에 쓸 글자',
    'zh-Hans': '按钮上的字', de: 'Beschriftung', fr: 'Texte du bouton',
    es: 'Texto del botón', pt: 'Texto do botão',
  },
  'type.link.target.label': {
    zh: '這顆按鈕打開', ja: 'このボタンで開くもの', en: 'This button opens',
    ko: '이 버튼이 여는 것', 'zh-Hans': '这颗按钮打开',
    de: 'Diese Schaltfläche öffnet', fr: 'Ce bouton ouvre',
    es: 'Este botón abre', pt: 'Este botão abre',
  },
  'type.link.url.label': {
    zh: '網址', ja: 'URL', en: 'Address', ko: '주소', 'zh-Hans': '网址',
    de: 'Adresse', fr: 'Adresse', es: 'Dirección', pt: 'Endereço',
  },
  'type.link.url.hint': {
    zh: '貼上整個網址，例如 https://instagram.com/你的帳號',
    ja: 'URL をそのまま貼り付け（例：https://instagram.com/あなたのID）',
    en: 'Paste the whole address, e.g. https://instagram.com/yourname',
    ko: '주소 전체를 붙여 넣으세요（예：https://instagram.com/내아이디）',
    'zh-Hans': '粘贴整个网址，例如 https://instagram.com/你的账号',
    de: 'Die ganze Adresse einfügen, z. B. https://instagram.com/ihrname',
    fr: 'Collez l’adresse entière, par exemple https://instagram.com/votrenom',
    es: 'Pega la dirección entera, por ejemplo https://instagram.com/tunombre',
    pt: 'Cole o endereço inteiro, por exemplo https://instagram.com/seunome',
  },
  'type.link.sub.label': {
    zh: '小字（選填）', ja: '補足（任意）', en: 'Small print (optional)', ko: '작은 글씨（선택）',
    'zh-Hans': '小字（选填）', de: 'Kleingedrucktes (optional)', fr: 'Petit texte (facultatif)',
    es: 'Letra pequeña (opcional)', pt: 'Letras miúdas (opcional)',
  },
  'type.link.advanced': {
    zh: '圖示設定', ja: 'アイコン設定', en: 'Icon settings', ko: '아이콘 설정',
    'zh-Hans': '图标设置', de: 'Symboleinstellungen', fr: 'Réglages de l’icône',
    es: 'Ajustes del icono', pt: 'Ajustes do ícone',
  },
  'type.link.icon.label': {
    zh: '內建圖示名稱', ja: '内蔵アイコン名', en: 'Built-in icon name', ko: '기본 아이콘 이름',
    'zh-Hans': '内置图标名称', de: 'Name des mitgelieferten Symbols', fr: 'Nom d’une icône fournie',
    es: 'Nombre de un icono incluido', pt: 'Nome de um ícone incluído',
  },
  'type.link.icon.hint': {
    zh: '留空會自動用那個網站的圖示。',
    ja: '空欄なら相手サイトのアイコンを自動で使います。',
    en: "Leave empty to use that site's own icon.",
    ko: '비워 두면 그 사이트의 아이콘을 자동으로 써요.',
    'zh-Hans': '留空会自动用那个网站的图标。',
    de: 'Leer lassen, um das Symbol der Website selbst zu verwenden.',
    fr: 'Laissez vide pour utiliser l’icône du site lui-même.',
    es: 'Déjalo vacío para usar el icono del propio sitio.',
    pt: 'Deixe em branco para usar o ícone do próprio site.',
  },
  'type.link.iconhost.label': {
    zh: '改用這個網站的圖示', ja: '別サイトのアイコンを使う', en: "Use another site's icon",
    ko: '다른 사이트의 아이콘 쓰기', 'zh-Hans': '改用这个网站的图标',
    de: 'Symbol einer anderen Website verwenden', fr: 'Utiliser l’icône d’un autre site',
    es: 'Usar el icono de otro sitio', pt: 'Usar o ícone de outro site',
  },
  'type.link.iconimg.label': {
    zh: '自己的圖示圖片', ja: '自分で用意したアイコン画像', en: 'Your own icon image',
    ko: '직접 준비한 아이콘 이미지', 'zh-Hans': '自己的图标图片',
    de: 'Eigenes Symbolbild', fr: 'Votre propre image d’icône',
    es: 'Tu propia imagen de icono', pt: 'Sua própria imagem de ícone',
  },

  // ── the picture tile ───────────────────────────────────────────────────────────────────────────
  'type.feature.title': {
    zh: '圖片', ja: '画像', en: 'Picture', ko: '사진', 'zh-Hans': '图片',
    de: 'Bild', fr: 'Image', es: 'Imagen', pt: 'Imagem',
  },
  'type.feature.hint': {
    zh: '一張照片；可以只是照片，也可以加標題和按鈕。',
    ja: '写真 1 枚。写真だけでも、見出しやボタンを重ねても。',
    en: 'One photo; on its own, or with a heading and a button on top.',
    ko: '사진 한 장. 사진만으로도, 제목과 버튼을 얹어도 좋아요.',
    'zh-Hans': '一张照片；可以只是照片，也可以加标题和按钮。',
    de: 'Ein Foto — für sich allein oder mit Überschrift und Schaltfläche darauf.',
    fr: 'Une photo : seule, ou avec un titre et un bouton par-dessus.',
    es: 'Una foto: sola, o con un título y un botón encima.',
    pt: 'Uma foto: sozinha, ou com um título e um botão por cima.',
  },
  'type.feature.img.label': {
    zh: '圖片', ja: '画像', en: 'Picture', ko: '사진', 'zh-Hans': '图片',
    de: 'Bild', fr: 'Image', es: 'Imagen', pt: 'Imagem',
  },
  'type.feature.alt.label': {
    zh: '這張圖是什麼', ja: 'この画像の説明', en: 'What this picture shows',
    ko: '이 사진은 무엇인가요', 'zh-Hans': '这张图是什么',
    de: 'Was auf dem Bild zu sehen ist', fr: 'Ce que montre l’image',
    es: 'Qué muestra la imagen', pt: 'O que a imagem mostra',
  },
  'type.feature.alt.hint': {
    zh: '看不到圖的人會讀到這句。',
    ja: '画像が見えない人にはこの文が読まれます。',
    en: "People who can't see the picture will read this.",
    ko: '사진을 볼 수 없는 사람은 이 문장을 읽게 돼요.',
    'zh-Hans': '看不到图的人会读到这句。',
    de: 'Wer das Bild nicht sehen kann, liest diesen Satz.',
    fr: 'Les personnes qui ne voient pas l’image liront cette phrase.',
    es: 'Quien no pueda ver la imagen leerá esta frase.',
    pt: 'Quem não consegue ver a imagem vai ler esta frase.',
  },
  'type.feature.label.label': {
    zh: '圖片下方顯示這句說明', ja: 'この説明を画像の下に表示', en: 'Show this caption under the picture',
    ko: '이 설명을 사진 아래에 보여 주기', 'zh-Hans': '图片下方显示这句说明',
    de: 'Diesen Text unter dem Bild anzeigen', fr: 'Afficher ce texte sous l’image',
    es: 'Mostrar este texto debajo de la imagen', pt: 'Mostrar este texto abaixo da imagem',
  },
  'type.feature.target.label': {
    zh: '點圖片會去哪裡', ja: '画像を押したときの行き先', en: 'Where the picture leads',
    ko: '사진을 누르면 가는 곳', 'zh-Hans': '点图片会去哪里',
    de: 'Wohin das Bild führt', fr: 'Où mène l’image',
    es: 'Adónde lleva la imagen', pt: 'Para onde a imagem leva',
  },
  'type.feature.href.label': {
    zh: '點圖片會去哪裡（選填）', ja: '画像を押したときの行き先（任意）', en: 'Where the picture leads (optional)',
    ko: '사진을 누르면 가는 곳（선택）', 'zh-Hans': '点图片会去哪里（选填）',
    de: 'Wohin das Bild führt (optional)', fr: 'Où mène l’image (facultatif)',
    es: 'Adónde lleva la imagen (opcional)', pt: 'Para onde a imagem leva (opcional)',
  },
  'type.feature.advanced': {
    zh: '加標題', ja: '見出しを付ける', en: 'Add a heading', ko: '제목 붙이기',
    'zh-Hans': '加标题', de: 'Überschrift hinzufügen', fr: 'Ajouter un titre',
    es: 'Añadir un título', pt: 'Adicionar um título',
  },
  'type.feature.title.label': {
    zh: '壓在圖上的標題（選填）', ja: '画像に重ねる見出し（任意）', en: 'Heading over the picture (optional)',
    ko: '사진 위에 얹을 제목（선택）', 'zh-Hans': '压在图上的标题（选填）',
    de: 'Überschrift auf dem Bild (optional)', fr: 'Titre par-dessus l’image (facultatif)',
    es: 'Título sobre la imagen (opcional)', pt: 'Título sobre a imagem (opcional)',
  },
  'type.feature.body.label': {
    zh: '標題上方的小字（選填）', ja: '見出しの上の小さな文字（任意）', en: 'Small line above the heading (optional)',
    ko: '제목 위의 작은 글씨（선택）', 'zh-Hans': '标题上方的小字（选填）',
    de: 'Kleine Zeile über der Überschrift (optional)', fr: 'Petite ligne au-dessus du titre (facultatif)',
    es: 'Línea pequeña encima del título (opcional)', pt: 'Linha pequena acima do título (opcional)',
  },
  'type.feature.cta.label': {
    zh: '按鈕文字（選填）', ja: 'ボタンの文字（任意）', en: 'Button text (optional)',
    ko: '버튼에 쓸 글자（선택）', 'zh-Hans': '按钮文字（选填）',
    de: 'Beschriftung der Schaltfläche (optional)', fr: 'Texte du bouton (facultatif)',
    es: 'Texto del botón (opcional)', pt: 'Texto do botão (opcional)',
  },
  'type.feature.cta.hint': {
    zh: '例如「看更多」。', ja: '例：「もっと見る」。', en: 'For example "See more".',
    ko: '예：「더 보기」.', 'zh-Hans': '例如「看更多」。',
    de: 'Zum Beispiel „Mehr ansehen“.', fr: 'Par exemple « Voir plus ».',
    es: 'Por ejemplo «Ver más».', pt: 'Por exemplo “Ver mais”.',
  },

  // ── the text tile ──────────────────────────────────────────────────────────────────────────────
  'type.text.title': {
    zh: '文字', ja: '文章', en: 'Text', ko: '글', 'zh-Hans': '文字',
    de: 'Text', fr: 'Texte', es: 'Texto', pt: 'Texto',
  },
  'type.text.hint': {
    zh: '一段話，佔滿整行，高度跟著內容。',
    ja: '文章のかたまり。横いっぱいに、長さは内容しだい。',
    en: 'A paragraph. Full width, as tall as it needs to be.',
    ko: '한 덩어리의 글. 가로 전체를 쓰고, 길이는 내용에 따라요.',
    'zh-Hans': '一段话，占满整行，高度跟着内容。',
    de: 'Ein Absatz. Volle Breite, so hoch wie nötig.',
    fr: 'Un paragraphe. Pleine largeur, aussi haut qu’il le faut.',
    es: 'Un párrafo. Todo el ancho, tan alto como haga falta.',
    pt: 'Um parágrafo. Largura total, tão alto quanto precisar.',
  },
  'type.text.body.label': {
    zh: '內容', ja: '内容', en: 'Text', ko: '내용', 'zh-Hans': '内容',
    de: 'Inhalt', fr: 'Contenu', es: 'Contenido', pt: 'Conteúdo',
  },
  'type.text.body.hint': {
    zh: '空一行就是分段。', ja: '空行を入れると段落が分かれます。',
    en: 'Leave an empty line to start a new paragraph.',
    ko: '빈 줄을 넣으면 문단이 나뉘어요.', 'zh-Hans': '空一行就是分段。',
    de: 'Eine Leerzeile beginnt einen neuen Absatz.',
    fr: 'Une ligne vide commence un nouveau paragraphe.',
    es: 'Una línea vacía empieza un párrafo nuevo.',
    pt: 'Uma linha em branco começa um novo parágrafo.',
  },

  // ── the video tile ─────────────────────────────────────────────────────────────────────────────
  'type.video.title': {
    zh: '影片', ja: '動画', en: 'Video', ko: '영상', 'zh-Hans': '视频',
    de: 'Video', fr: 'Vidéo', es: 'Vídeo', pt: 'Vídeo',
  },
  'type.video.hint': {
    zh: '一支 YouTube 影片，訪客按了才會播放。',
    ja: 'YouTube の動画。訪問者が押したときだけ再生されます。',
    en: 'A YouTube video that only plays when a visitor taps it.',
    ko: 'YouTube 영상. 방문자가 눌렀을 때만 재생돼요.',
    'zh-Hans': '一支 YouTube 视频，访客按了才会播放。',
    de: 'Ein YouTube-Video, das erst abspielt, wenn jemand darauf tippt.',
    fr: 'Une vidéo YouTube qui ne démarre que si un visiteur la touche.',
    es: 'Un vídeo de YouTube que solo se reproduce cuando alguien lo toca.',
    pt: 'Um vídeo do YouTube que só toca quando alguém toca nele.',
  },
  'type.video.yt.label': {
    zh: 'YouTube 影片編號', ja: 'YouTube 動画の ID', en: 'YouTube video id',
    ko: 'YouTube 영상 ID', 'zh-Hans': 'YouTube 视频编号',
    de: 'YouTube-Video-Kennung', fr: 'Identifiant de la vidéo YouTube',
    es: 'Identificador del vídeo de YouTube', pt: 'Identificador do vídeo do YouTube',
  },
  'type.video.yt.hint': {
    zh: '一支影片。和「頻道」二選一。', ja: '動画 1 本。「チャンネル」とどちらか一方です。',
    en: 'One video. Either this or the channel, not both.',
    ko: '영상 하나. 「채널」과 둘 중 하나만 쓰세요.',
    'zh-Hans': '一支视频。和「频道」二选一。',
    de: 'Ein Video. Entweder dies oder der Kanal, nicht beides.',
    fr: 'Une vidéo. Ceci ou la chaîne, pas les deux.',
    es: 'Un vídeo. Esto o el canal, no ambos.',
    pt: 'Um vídeo. Isto ou o canal, não os dois.',
  },
  'type.video.channel.label': {
    zh: '或：永遠顯示這個頻道最新的一支', ja: 'または：このチャンネルの最新動画をいつも表示',
    en: "Or: always show this channel's newest video",
    ko: '또는：이 채널의 최신 영상을 항상 보여 주기',
    'zh-Hans': '或：永远显示这个频道最新的一支',
    de: 'Oder: immer das neueste Video dieses Kanals zeigen',
    fr: 'Ou : toujours montrer la dernière vidéo de cette chaîne',
    es: 'O: mostrar siempre el vídeo más reciente de este canal',
    pt: 'Ou: mostrar sempre o vídeo mais recente deste canal',
  },
  'type.video.channel.hint': {
    zh: '', ja: '', en: '', ko: '', 'zh-Hans': '', de: '', fr: '', es: '', pt: '',
  },
  'type.video.body.label': {
    zh: '影片標題（選填）', ja: '動画のタイトル（任意）', en: 'Video title (optional)',
    ko: '영상 제목（선택）', 'zh-Hans': '视频标题（选填）',
    de: 'Videotitel (optional)', fr: 'Titre de la vidéo (facultatif)',
    es: 'Título del vídeo (opcional)', pt: 'Título do vídeo (opcional)',
  },
  'type.video.body.hint': {
    zh: '留空會用影片自己的標題。', ja: '空欄なら動画のタイトルをそのまま使います。',
    en: "Leave empty to use the video's own title.",
    ko: '비워 두면 영상의 원래 제목을 써요.', 'zh-Hans': '留空会用视频自己的标题。',
    de: 'Leer lassen, um den eigenen Titel des Videos zu verwenden.',
    fr: 'Laissez vide pour utiliser le titre de la vidéo.',
    es: 'Déjalo vacío para usar el título del propio vídeo.',
    pt: 'Deixe em branco para usar o título do próprio vídeo.',
  },
  'type.video.poster.label': {
    zh: '自己的封面圖（選填）', ja: '自分で用意する表紙画像（任意）', en: 'Your own cover picture (optional)',
    ko: '직접 준비한 표지 사진（선택）', 'zh-Hans': '自己的封面图（选填）',
    de: 'Eigenes Titelbild (optional)', fr: 'Votre propre image de couverture (facultatif)',
    es: 'Tu propia imagen de portada (opcional)', pt: 'Sua própria imagem de capa (opcional)',
  },
  'type.video.poster.hint': {
    zh: '留空會用影片自己的封面。', ja: '空欄なら動画の表紙をそのまま使います。',
    en: "Leave empty to use the video's own cover.",
    ko: '비워 두면 영상의 원래 표지를 써요.', 'zh-Hans': '留空会用视频自己的封面。',
    de: 'Leer lassen, um das Titelbild des Videos zu verwenden.',
    fr: 'Laissez vide pour utiliser la couverture de la vidéo.',
    es: 'Déjalo vacío para usar la portada del propio vídeo.',
    pt: 'Deixe em branco para usar a capa do próprio vídeo.',
  },

  // ── the social-icons tile ──────────────────────────────────────────────────────────────────────
  'type.social.title': {
    zh: '社群圖示', ja: 'SNS アイコン', en: 'Social icons', ko: 'SNS 아이콘',
    'zh-Hans': '社群图标', de: 'Social-Media-Symbole', fr: 'Icônes de réseaux sociaux',
    es: 'Iconos de redes sociales', pt: 'Ícones de redes sociais',
  },
  'type.social.hint': {
    zh: '一排小圖示，沒有文字。', ja: '小さなアイコンが横一列。文字はありません。',
    en: 'A row of small icons, no text.',
    ko: '작은 아이콘이 한 줄. 글자는 없어요.', 'zh-Hans': '一排小图标，没有文字。',
    de: 'Eine Reihe kleiner Symbole, ohne Text.',
    fr: 'Une rangée de petites icônes, sans texte.',
    es: 'Una fila de iconos pequeños, sin texto.',
    pt: 'Uma fila de ícones pequenos, sem texto.',
  },
  'type.social.body.label': {
    zh: '你的帳號', ja: 'あなたのアカウント', en: 'Your accounts', ko: '내 계정',
    'zh-Hans': '你的账号', de: 'Ihre Konten', fr: 'Vos comptes',
    es: 'Tus cuentas', pt: 'Suas contas',
  },
  'type.social.body.hint': {
    zh: '一行一個：名稱，然後網址。',
    ja: '1 行に 1 つ：名前のあとに URL。',
    en: 'One per line: the name, then the address.',
    ko: '한 줄에 하나：이름 다음에 주소.',
    'zh-Hans': '一行一个：名称，然后网址。',
    de: 'Eines pro Zeile: der Name, dann die Adresse.',
    fr: 'Un par ligne : le nom, puis l’adresse.',
    es: 'Uno por línea: el nombre y luego la dirección.',
    pt: 'Um por linha: o nome e depois o endereço.',
  },

  // ── the slideshow tile ─────────────────────────────────────────────────────────────────────────
  'type.embed.title': {
    zh: '輪播', ja: 'スライド', en: 'Slideshow', ko: '슬라이드', 'zh-Hans': '轮播',
    de: 'Diaschau', fr: 'Diaporama', es: 'Pase de imágenes', pt: 'Apresentação de imagens',
  },
  'type.embed.hint': {
    zh: '好幾張圖片輪流顯示。', ja: '複数の画像を順に表示します。',
    en: 'Several pictures, one after another.',
    ko: '여러 장의 사진을 차례로 보여 줘요.', 'zh-Hans': '好几张图片轮流显示。',
    de: 'Mehrere Bilder, eines nach dem anderen.',
    fr: 'Plusieurs images, l’une après l’autre.',
    es: 'Varias imágenes, una tras otra.',
    pt: 'Várias imagens, uma após a outra.',
  },
  'type.embed.kind.label': {
    zh: '樣式', ja: '形式', en: 'Style', ko: '형식', 'zh-Hans': '样式',
    de: 'Art', fr: 'Style', es: 'Estilo', pt: 'Estilo',
  },
  'type.embed.kind.hint': {
    zh: '「slider」左右滑動，「bubbles」泡泡彈出。',
    ja: '「slider」は横にスライド、「bubbles」はふわっと切り替え。',
    en: '"slider" slides sideways; "bubbles" pops in and out.',
    ko: '「slider」는 옆으로 넘기고,「bubbles」는 톡 나타났다 사라져요.',
    'zh-Hans': '「slider」左右滑动，「bubbles」泡泡弹出。',
    de: '„slider“ gleitet seitwärts, „bubbles“ blendet ein und aus.',
    fr: '« slider » glisse latéralement, « bubbles » apparaît et disparaît.',
    es: '«slider» se desliza de lado, «bubbles» aparece y desaparece.',
    pt: '“slider” desliza para o lado, “bubbles” aparece e desaparece.',
  },
  'type.embed.images.label': {
    zh: '圖片', ja: '画像', en: 'Pictures', ko: '사진', 'zh-Hans': '图片',
    de: 'Bilder', fr: 'Images', es: 'Imágenes', pt: 'Imagens',
  },
  'type.embed.images.hint': {
    zh: '用逗號分開每一張。', ja: 'カンマで区切ります。', en: 'Separate each one with a comma.',
    ko: '쉼표로 구분해 주세요.', 'zh-Hans': '用逗号分开每一张。',
    de: 'Mit Kommas trennen.', fr: 'Séparez chacune par une virgule.',
    es: 'Sepáralas con comas.', pt: 'Separe cada uma com vírgula.',
  },

  // ── width, which every tile has ────────────────────────────────────────────────────────────────
  'width.label': {
    zh: '寬度', ja: '幅', en: 'Width', ko: '너비', 'zh-Hans': '宽度',
    de: 'Breite', fr: 'Largeur', es: 'Anchura', pt: 'Largura',
  },
  'width.hint': {
    zh: '一張卡橫向共 6 格。', ja: 'カードの横幅は 6 マスです。', en: 'A card is 6 columns wide.',
    ko: '카드는 가로로 6 칸이에요.', 'zh-Hans': '一张卡横向共 6 格。',
    de: 'Eine Karte ist 6 Spalten breit.', fr: 'Une carte fait 6 colonnes de large.',
    es: 'Una tarjeta tiene 6 columnas de ancho.', pt: 'Um cartão tem 6 colunas de largura.',
  },
  'width.6': {
    zh: '6（整行）', ja: '6（横いっぱい）', en: '6 (full row)', ko: '6（한 줄 전체）',
    'zh-Hans': '6（整行）', de: '6 (ganze Zeile)', fr: '6 (toute la ligne)',
    es: '6 (fila entera)', pt: '6 (linha inteira)',
  },
  'width.3': {
    zh: '3（一半）', ja: '3（半分）', en: '3 (half)', ko: '3（절반）',
    'zh-Hans': '3（一半）', de: '3 (die Hälfte)', fr: '3 (la moitié)',
    es: '3 (la mitad)', pt: '3 (metade)',
  },

  // ── what a NEW tile starts as ──────────────────────────────────────────────────────────────────
  //
  // 🩸 These were Chinese literals too, so a German visitor pressing "Add a tile → Link" watched
  // 「新的連結」 appear on their own card.
  'blank.link.text': {
    zh: '新的連結', ja: '新しいリンク', en: 'New link', ko: '새 링크', 'zh-Hans': '新的链接',
    de: 'Neuer Link', fr: 'Nouveau lien', es: 'Enlace nuevo', pt: 'Novo link',
  },
  'blank.text': {
    zh: '寫點什麼。', ja: 'ここに文章を。', en: 'Write something.', ko: '무언가 적어 보세요.',
    'zh-Hans': '写点什么。', de: 'Schreiben Sie etwas.', fr: 'Écrivez quelque chose.',
    es: 'Escribe algo.', pt: 'Escreva alguma coisa.',
  },
  'blank.profile': {
    zh: '一句話介紹你自己', ja: 'あなたをひとことで', en: 'One line about you',
    ko: '나를 한 줄로', 'zh-Hans': '一句话介绍你自己',
    de: 'Eine Zeile über Sie', fr: 'Une ligne sur vous',
    es: 'Una línea sobre ti', pt: 'Uma linha sobre você',
  },
};

/** Every key this table carries — the list the tests walk, and the list a form may reference. */
export const CELL_KEYS = Object.keys(CELL_STRINGS_BY_KEY);

/**
 * A locale key → a plain `key → string` table.
 *
 * 🔴 Falls back to English per KEY, not per table: a key added tomorrow and translated on Thursday
 * shows English on Wednesday rather than the key itself. The test forbids that state from shipping;
 * this decides what happens if it ever does anyway.
 */
export function cellStrings(localeKey) {
  const out = {};
  for (const [key, row] of Object.entries(CELL_STRINGS_BY_KEY)) {
    const v = row[localeKey];
    out[key] = typeof v === 'string' ? v : row.en;
  }
  return out;
}

/** The Traditional Chinese table — the internal editor's own language. See editor.mjs's `T`. */
export const CELL_STRINGS_ZH = cellStrings('zh');

/**
 * `text(table, value)` — resolve a definition's string.
 *
 * A definition's `title`/`label`/`hint` is a KEY. Anything not in the table is returned as written,
 * which is what keeps the RAW-disposition params (never rendered to a person, see ai-ops.mjs) and
 * any hand-written literal working unchanged.
 */
export const text = (table, value) => {
  const v = value == null ? '' : String(value);
  return Object.prototype.hasOwnProperty.call(table, v) ? table[v] : v;
};
