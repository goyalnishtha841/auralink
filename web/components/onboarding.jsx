"use client";
// First-run onboarding for the passenger seat screen: a short, skippable tour of what Auralink
// can do, hosted by a small illustrated crew-avatar character. Nothing here is a second product --
// language selection calls the real setLanguage() the rest of the app uses, accessibility toggles
// write the same fields showSettings() does, speech goes through lib/speech.js's existing offline
// voice (Kokoro, with the OS voice as its own fallback), and the feature tour uses the real intents
// from /api/config. The "scenario" and "visual" steps are clearly-labelled demos -- they never open
// a socket or create a real request, so trying the tutorial can never page the cabin crew.
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icons";
import { Picto } from "@/lib/pictograms";
import { canSpeak, isSpeaking, onSpeakingChange, speakNatural as speak, stopSpeaking } from "@/lib/speech";
import { ease } from "@/components/ui";

// One locally-hosted photo stands in for every screen's cabin/window background (see the CSS
// comment above .ob-bg): there's no separate cabin-interior photo in this project, so overlay
// strength -- not a different image -- is what distinguishes a "window" moment from a dense
// list screen. Never fetched at runtime; part of the Next.js build like every other asset here.
const BG_SRC = "/hero.jpg";

function ScreenBg({ dim = false }) {
  return (
    <div className={`ob-bg ${dim ? "dim" : ""}`} aria-hidden="true">
      <Image src={BG_SRC} alt="" fill priority sizes="100vw" />
    </div>
  );
}

// A small set of fixed hues stands in for a flag/language icon -- there are no flag assets in
// this project and emoji flags render inconsistently offline across platforms/fonts -- a solid
// colour chip with the language's own ISO code is legible and doesn't misrepresent any country.
const LANG_HUES = ["#2f6fed", "#e0663f", "#2fa86a", "#b05fe0", "#d4a72f", "#e04f7a", "#3fb8c9", "#8a6fe0", "#e0953f"];
function langChipColor(code) { let h = 0; for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0; return LANG_HUES[h % LANG_HUES.length]; }

// Onboarding has its own narrative copy (not the per-screen UI strings in data/i18n) and its own
// Onboarding's own offline voice covers exactly the languages lib/speech.js already has a voice
// for -- a real infrastructure limit, not a content gap. Every passenger language in
// data/languages.json gets the FULL tutorial text below; VOICED_LANGS only gates whether the
// assistant also speaks it out loud, with a visible note when it can't, same as the rest of the
// app never silently claims support that isn't there.
export const VOICED_LANGS = ["en", "hi", "ta", "th"];

function L(welcomeTitle, welcomeBody, getStarted, skip, chooseLang, chooseLangSub, greeting, featuresTitle, features,
  scenarioTitle, scenarioSub, scenarios, demoTag, simTitle, visualTitle, visualSub, announceTitle, announceSub,
  accessTitle, accessSub, largeText, simpleLang, audioGuide, doneTitle, doneBody, checklist, startUsing,
  replay, next, askHelp, replayTutorial, startSimulation, translating, translated, crewRespondTitle, needHelp) {
  return { welcomeTitle, welcomeBody, getStarted, skip, chooseLang, chooseLangSub, greeting, featuresTitle, features,
    scenarioTitle, scenarioSub, scenarios, demoTag, simTitle, visualTitle, visualSub, announceTitle, announceSub,
    accessTitle, accessSub, largeText, simpleLang, audioGuide, doneTitle, doneBody, checklist, startUsing,
    replay, next, askHelp, replayTutorial, startSimulation, translating, translated, crewRespondTitle, needHelp };
}
// features/scenarios keep the same id+icon in every language (ids drive demo logic/icons); only
// the label text changes, so each language passes just [title, desc] pairs / [label] here.
function feats(ids, icons, pairs) { return ids.map((id, i) => ({ id, icon: icons[i], title: pairs[i][0], desc: pairs[i][1] })); }
function scens(ids, icons, labels) { return ids.map((id, i) => ({ id, icon: icons[i], label: labels[i] })); }
const F_IDS = ["talk", "request", "announcements", "medical", "visual", "offline"];
const F_ICONS = ["chat", "water", "bell", "medical", "grid", "wifi_off"];
const S_IDS = ["water", "blanket", "medical"];
const S_ICONS = ["water", "blanket", "medical"];

const COPY = {
  en: L("Welcome aboard!", "I'm your personal Auralink assistant. I'll show you how to talk comfortably with your cabin crew, whatever language you speak.",
    "Let's get started", "Skip tutorial", "Choose your language", "You can change this any time from the seat screen.",
    (name) => `Hello! From now on I'll talk with you in ${name}.`,
    "What you can do", feats(F_IDS, F_ICONS, [
      ["Talk to crew", "Speak or type in your language — I translate it for the crew."],
      ["Request services", "Water, food, a blanket and more, one tap away."],
      ["Understand announcements", "Crew announcements shown as text and pictures in your language."],
      ["Medical & special help", "Tell the crew exactly what you need, even under stress."],
      ["Visual communication", "Prefer not to speak? Tap pictures instead."],
      ["Works offline", "Runs on this aircraft's own system — no internet needed."],
    ]),
    "Let's try requesting something", "Pick one to see how it works.",
    scens(S_IDS, S_ICONS, ["Request water", "Request a blanket", "Ask for assistance"]),
    "Demo — nothing is sent to the crew", "Here's how a real request looks",
    "Prefer pictures?", "Tap any picture to ask for it — no typing or speaking needed.",
    "Understanding announcements", "Crew announcements appear like this, in your language, with a picture.",
    "Make it comfortable for you", "You can change these any time from the seat screen.",
    "Larger text", "Simple language & pictures", "Read things aloud",
    "You're all set!", "You can now talk to your cabin crew comfortably. I'm here whenever you need help.",
    ["Language selected", "Features introduced", "Simulation completed", "Preferences set"], "Start using Auralink",
    "Replay", "Next", "Ask for help", "Replay tutorial", "Start simulation", "Translating for the crew…",
    "Translated for the crew", "The crew replies", "Need help? Tap me anytime."),

  hi: L("स्वागत है!", "मैं आपका व्यक्तिगत Auralink सहायक हूँ। मैं आपको दिखाऊँगा कि आप अपनी भाषा में चालक दल से आराम से कैसे बात कर सकते हैं।",
    "शुरू करें", "ट्यूटोरियल छोड़ें", "अपनी भाषा चुनें", "आप इसे सीट स्क्रीन से कभी भी बदल सकते हैं।",
    (name) => `नमस्ते! अब से मैं आपसे ${name} में बात करूँगा।`,
    "आप क्या कर सकते हैं", feats(F_IDS, F_ICONS, [
      ["चालक दल से बात करें", "अपनी भाषा में बोलें या टाइप करें — मैं इसे चालक दल के लिए अनुवाद करता हूँ।"],
      ["सेवाओं का अनुरोध करें", "पानी, भोजन, कंबल और अधिक, एक टैप में।"],
      ["घोषणाएँ समझें", "चालक दल की घोषणाएँ आपकी भाषा में पाठ और चित्रों के रूप में।"],
      ["चिकित्सा और विशेष सहायता", "तनाव में भी चालक दल को बताएं कि आपको क्या चाहिए।"],
      ["चित्रों से बात करें", "बोलना नहीं चाहते? बस चित्रों पर टैप करें।"],
      ["बिना इंटरनेट के काम करता है", "यह विमान के अपने सिस्टम पर चलता है — इंटरनेट की ज़रूरत नहीं।"],
    ]),
    "कुछ अनुरोध करके देखें", "देखने के लिए एक चुनें कि यह कैसे काम करता है।",
    scens(S_IDS, S_ICONS, ["पानी माँगें", "कंबल माँगें", "सहायता माँगें"]),
    "डेमो — चालक दल को कुछ नहीं भेजा गया", "एक असली अनुरोध ऐसा दिखता है",
    "चित्र पसंद हैं?", "अनुरोध करने के लिए किसी भी चित्र पर टैप करें — टाइप या बोलने की ज़रूरत नहीं।",
    "घोषणाएँ समझना", "चालक दल की घोषणाएँ आपकी भाषा में, एक चित्र के साथ, ऐसी दिखती हैं।",
    "इसे अपने लिए आरामदायक बनाएं", "आप इन्हें सीट स्क्रीन से कभी भी बदल सकते हैं।",
    "बड़ा टेक्स्ट", "सरल भाषा और चित्र", "ज़ोर से पढ़ें",
    "आप तैयार हैं!", "अब आप अपने चालक दल से आराम से बात कर सकते हैं। जब भी मदद चाहिए, मैं यहाँ हूँ।",
    ["भाषा चुनी गई", "सुविधाएँ परिचित कराई गईं", "डेमो पूरा हुआ", "प्राथमिकताएँ सेट हुईं"], "Auralink का उपयोग शुरू करें",
    "फिर से सुनें", "आगे", "मदद माँगें", "ट्यूटोरियल फिर से देखें", "सिमुलेशन शुरू करें", "चालक दल के लिए अनुवाद हो रहा है…",
    "चालक दल के लिए अनुवादित", "चालक दल का जवाब", "मदद चाहिए? मुझे कभी भी टैप करें।"),

  ta: L("வரவேற்கிறோம்!", "நான் உங்கள் தனிப்பட்ட Auralink உதவியாளர். நீங்கள் பேசும் மொழியில் பணியாளர்களுடன் எளிதாக பேசுவது எப்படி என்று காட்டுகிறேன்.",
    "தொடங்குவோம்", "பயிற்சியைத் தவிர்க்கவும்", "உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்", "இதை நீங்கள் எப்போது வேண்டுமானாலும் மாற்றலாம்.",
    (name) => `வணக்கம்! இனி நான் உங்களுடன் ${name} மொழியில் பேசுவேன்.`,
    "நீங்கள் செய்யக்கூடியவை", feats(F_IDS, F_ICONS, [
      ["பணியாளருடன் பேசுங்கள்", "உங்கள் மொழியில் பேசுங்கள் அல்லது தட்டச்சு செய்யுங்கள் — நான் பணியாளருக்கு மொழிபெயர்க்கிறேன்."],
      ["சேவைகளைக் கோருங்கள்", "தண்ணீர், உணவு, போர்வை — ஒரு தட்டில்."],
      ["அறிவிப்புகளைப் புரிந்துகொள்ளுங்கள்", "பணியாளர் அறிவிப்புகள் உங்கள் மொழியில் உரையாகவும் படமாகவும்."],
      ["மருத்துவ உதவி", "உங்களுக்கு என்ன தேவை என்பதை பணியாளரிடம் சொல்லுங்கள்."],
      ["படங்கள் மூலம் தொடர்பு", "பேச விரும்பவில்லையா? படங்களைத் தட்டவும்."],
      ["இணையமின்றி செயல்படும்", "இந்த விமானத்தின் சொந்த அமைப்பில் இயங்குகிறது."],
    ]),
    "ஒன்றைக் கோரிப் பார்ப்போம்", "இது எப்படி வேலை செய்கிறது என்று பார்க்க ஒன்றைத் தேர்ந்தெடுக்கவும்.",
    scens(S_IDS, S_ICONS, ["தண்ணீர் கேளுங்கள்", "போர்வை கேளுங்கள்", "உதவி கேளுங்கள்"]),
    "டெமோ — பணியாளருக்கு எதுவும் அனுப்பப்படவில்லை", "ஒரு உண்மையான கோரிக்கை இப்படி இருக்கும்",
    "படங்கள் பிடிக்குமா?", "கோர எந்த படத்தையும் தட்டவும் — தட்டச்சு அல்லது பேச வேண்டாம்.",
    "அறிவிப்புகளைப் புரிந்துகொள்ளுதல்", "பணியாளர் அறிவிப்புகள் உங்கள் மொழியில், ஒரு படத்துடன் இப்படி காட்டப்படும்.",
    "இதை உங்களுக்கு வசதியாக்குங்கள்", "இவற்றை சீட் திரையிலிருந்து எப்போது வேண்டுமானாலும் மாற்றலாம்.",
    "பெரிய எழுத்து", "எளிய மொழி & படங்கள்", "சத்தமாகப் படிக்கவும்",
    "நீங்கள் தயார்!", "இப்போது உங்கள் பணியாளருடன் எளிதாக பேசலாம். உதவி தேவைப்படும்போது நான் இங்கே இருக்கிறேன்.",
    ["மொழி தேர்ந்தெடுக்கப்பட்டது", "அம்சங்கள் அறிமுகம்", "டெமோ முடிந்தது", "விருப்பத்தேர்வுகள் அமைக்கப்பட்டன"], "Auralink-ஐப் பயன்படுத்தத் தொடங்குங்கள்",
    "மீண்டும் கேளுங்கள்", "அடுத்து", "உதவி கேளுங்கள்", "பயிற்சியை மீண்டும் காண்க", "சிமுலேஷனைத் தொடங்கு",
    "பணியாளருக்காக மொழிபெயர்க்கப்படுகிறது…", "பணியாளருக்காக மொழிபெயர்க்கப்பட்டது", "பணியாளர் பதில்", "உதவி வேண்டுமா? எப்போதும் என்னைத் தட்டவும்."),

  th: L("ยินดีต้อนรับ!", "ฉันคือผู้ช่วย Auralink ส่วนตัวของคุณ ฉันจะแสดงให้คุณเห็นวิธีพูดคุยกับลูกเรือได้อย่างสบายใจ ไม่ว่าคุณจะพูดภาษาอะไร",
    "เริ่มกันเลย", "ข้ามบทแนะนำ", "เลือกภาษาของคุณ", "คุณสามารถเปลี่ยนได้ทุกเมื่อจากหน้าจอที่นั่ง",
    (name) => `สวัสดีค่ะ! ต่อจากนี้ฉันจะพูดกับคุณเป็นภาษา${name}`,
    "สิ่งที่คุณทำได้", feats(F_IDS, F_ICONS, [
      ["พูดคุยกับลูกเรือ", "พูดหรือพิมพ์เป็นภาษาของคุณ — ฉันแปลให้ลูกเรือ"],
      ["ขอบริการ", "น้ำ อาหาร ผ้าห่ม และอื่น ๆ เพียงแตะเดียว"],
      ["เข้าใจประกาศ", "ประกาศจากลูกเรือแสดงเป็นข้อความและภาพในภาษาของคุณ"],
      ["ความช่วยเหลือทางการแพทย์", "บอกลูกเรือว่าคุณต้องการอะไร แม้ในยามเครียด"],
      ["สื่อสารด้วยภาพ", "ไม่อยากพูด? แตะภาพแทนได้"],
      ["ทำงานได้โดยไม่ต้องใช้อินเทอร์เน็ต", "ทำงานบนระบบของเครื่องบินลำนี้เอง"],
    ]),
    "ลองขอสิ่งของดูสิ", "เลือกสถานการณ์เพื่อดูว่ามันทำงานอย่างไร",
    scens(S_IDS, S_ICONS, ["ขอน้ำ", "ขอผ้าห่ม", "ขอความช่วยเหลือ"]),
    "ตัวอย่าง — ไม่มีการส่งถึงลูกเรือจริง", "คำขอจริงจะมีลักษณะแบบนี้",
    "ชอบใช้ภาพไหม?", "แตะภาพใดก็ได้เพื่อขอสิ่งนั้น ไม่ต้องพิมพ์หรือพูด",
    "เข้าใจประกาศ", "ประกาศจากลูกเรือจะแสดงแบบนี้ เป็นภาษาของคุณ พร้อมภาพประกอบ",
    "ปรับให้เหมาะกับคุณ", "คุณสามารถเปลี่ยนได้ทุกเมื่อจากหน้าจอที่นั่ง",
    "ตัวอักษรใหญ่ขึ้น", "ภาษาง่าย & ภาพ", "อ่านออกเสียง",
    "พร้อมแล้ว!", "ตอนนี้คุณสามารถพูดคุยกับลูกเรือได้อย่างสบายใจ ฉันอยู่ที่นี่เสมอเมื่อคุณต้องการความช่วยเหลือ",
    ["เลือกภาษาแล้ว", "แนะนำฟีเจอร์แล้ว", "ลองใช้งานตัวอย่างแล้ว", "ตั้งค่าความชอบแล้ว"], "เริ่มใช้งาน Auralink",
    "ฟังอีกครั้ง", "ถัดไป", "ขอความช่วยเหลือ", "ดูบทแนะนำอีกครั้ง", "เริ่มตัวอย่าง", "กำลังแปลให้ลูกเรือ…",
    "แปลให้ลูกเรือแล้ว", "ลูกเรือตอบกลับ", "ต้องการความช่วยเหลือไหม? แตะฉันได้ทุกเมื่อ"),

  zh: L("欢迎登机！", "我是您的专属 Auralink 助手。无论您说哪种语言，我都会教您如何轻松地与机组人员交流。",
    "开始吧", "跳过教程", "选择您的语言", "您可以随时在座位屏幕上更改此设置。",
    (name) => `您好！从现在起我会用${name}和您交流。`,
    "您可以做什么", feats(F_IDS, F_ICONS, [
      ["与机组交流", "用您的语言说话或打字——我会为机组翻译。"],
      ["请求服务", "水、食物、毛毯等，轻点即可。"],
      ["理解广播", "机组广播以您的语言显示为文字和图片。"],
      ["医疗和特殊帮助", "即使在紧张时刻，也能准确告诉机组您需要什么。"],
      ["图片交流", "不想说话？点击图片即可。"],
      ["离线运行", "在本机自带系统上运行——无需互联网。"],
    ]),
    "试着提出一个请求", "选择一个场景，看看它是如何运作的。",
    scens(S_IDS, S_ICONS, ["请求喝水", "请求毛毯", "请求帮助"]),
    "演示——不会发送给机组", "真实请求是这样的",
    "喜欢用图片吗？", "点击任意图片即可请求——无需打字或说话。",
    "理解广播", "机组广播会以您的语言和图片这样显示。",
    "为您调整得更舒适", "您可以随时在座位屏幕上更改这些设置。",
    "更大的文字", "简单语言和图片", "朗读内容",
    "一切就绪！", "现在您可以轻松地与机组交流了。需要帮助时我随时都在。",
    ["已选择语言", "已介绍功能", "演示已完成", "偏好已设置"], "开始使用 Auralink",
    "重播", "下一步", "寻求帮助", "重新观看教程", "开始演示", "正在为机组翻译…",
    "已为机组翻译", "机组回复", "需要帮助？随时点我。"),

  es: L("¡Bienvenido a bordo!", "Soy tu asistente personal de Auralink. Te mostraré cómo hablar cómodamente con la tripulación, sea cual sea tu idioma.",
    "Empecemos", "Omitir tutorial", "Elige tu idioma", "Puedes cambiarlo en cualquier momento desde la pantalla de tu asiento.",
    (name) => `¡Hola! A partir de ahora hablaré contigo en ${name}.`,
    "Qué puedes hacer", feats(F_IDS, F_ICONS, [
      ["Hablar con la tripulación", "Habla o escribe en tu idioma — yo lo traduzco para la tripulación."],
      ["Solicitar servicios", "Agua, comida, una manta y más, con un solo toque."],
      ["Entender los anuncios", "Los anuncios de la tripulación se muestran como texto e imágenes en tu idioma."],
      ["Ayuda médica y especial", "Dile a la tripulación exactamente qué necesitas, incluso bajo estrés."],
      ["Comunicación visual", "¿Prefieres no hablar? Toca imágenes en su lugar."],
      ["Funciona sin conexión", "Funciona con el sistema propio del avión — no necesita internet."],
    ]),
    "Probemos a pedir algo", "Elige uno para ver cómo funciona.",
    scens(S_IDS, S_ICONS, ["Pedir agua", "Pedir una manta", "Pedir ayuda"]),
    "Demo — no se envía nada a la tripulación", "Así se ve una solicitud real",
    "¿Prefieres imágenes?", "Toca cualquier imagen para pedirla — no hace falta escribir ni hablar.",
    "Entender los anuncios", "Los anuncios de la tripulación aparecen así, en tu idioma, con una imagen.",
    "Hazlo cómodo para ti", "Puedes cambiar esto en cualquier momento desde la pantalla de tu asiento.",
    "Texto más grande", "Lenguaje simple y figuras", "Leer en voz alta",
    "¡Todo listo!", "Ya puedes hablar con tu tripulación cómodamente. Estoy aquí cuando necesites ayuda.",
    ["Idioma seleccionado", "Funciones presentadas", "Simulación completada", "Preferencias configuradas"], "Empezar a usar Auralink",
    "Repetir", "Siguiente", "Pedir ayuda", "Repetir tutorial", "Iniciar simulación", "Traduciendo para la tripulación…",
    "Traducido para la tripulación", "La tripulación responde", "¿Necesitas ayuda? Tócame cuando quieras."),

  fr: L("Bienvenue à bord !", "Je suis votre assistant personnel Auralink. Je vais vous montrer comment communiquer facilement avec l'équipage, quelle que soit votre langue.",
    "Commençons", "Passer le tutoriel", "Choisissez votre langue", "Vous pouvez changer cela à tout moment depuis l'écran de votre siège.",
    (name) => `Bonjour ! Désormais, je vous parlerai en ${name}.`,
    "Ce que vous pouvez faire", feats(F_IDS, F_ICONS, [
      ["Parler à l'équipage", "Parlez ou écrivez dans votre langue — je traduis pour l'équipage."],
      ["Demander des services", "Eau, nourriture, couverture et plus, en un geste."],
      ["Comprendre les annonces", "Les annonces de l'équipage s'affichent en texte et en images dans votre langue."],
      ["Aide médicale et spéciale", "Dites exactement à l'équipage ce dont vous avez besoin, même sous stress."],
      ["Communication visuelle", "Vous préférez ne pas parler ? Touchez des images à la place."],
      ["Fonctionne hors ligne", "Fonctionne sur le système de l'avion — aucune connexion internet requise."],
    ]),
    "Essayons de faire une demande", "Choisissez-en une pour voir comment ça marche.",
    scens(S_IDS, S_ICONS, ["Demander de l'eau", "Demander une couverture", "Demander de l'aide"]),
    "Démo — rien n'est envoyé à l'équipage", "Voici à quoi ressemble une vraie demande",
    "Vous préférez les images ?", "Touchez n'importe quelle image pour la demander — pas besoin d'écrire ni de parler.",
    "Comprendre les annonces", "Les annonces de l'équipage apparaissent ainsi, dans votre langue, avec une image.",
    "Adaptez-le à votre confort", "Vous pouvez changer cela à tout moment depuis l'écran de votre siège.",
    "Texte plus grand", "Langage simple et images", "Lire à voix haute",
    "Vous êtes prêt !", "Vous pouvez maintenant parler à votre équipage confortablement. Je suis là dès que vous avez besoin d'aide.",
    ["Langue sélectionnée", "Fonctionnalités présentées", "Simulation terminée", "Préférences définies"], "Commencer à utiliser Auralink",
    "Rejouer", "Suivant", "Demander de l'aide", "Revoir le tutoriel", "Démarrer la simulation", "Traduction pour l'équipage…",
    "Traduit pour l'équipage", "L'équipage répond", "Besoin d'aide ? Touchez-moi à tout moment."),

  it: L("Benvenuto a bordo!", "Sono il tuo assistente personale Auralink. Ti mostrerò come parlare comodamente con l'equipaggio, qualunque lingua tu parli.",
    "Iniziamo", "Salta il tutorial", "Scegli la tua lingua", "Puoi cambiarla in qualsiasi momento dalla schermata del tuo posto.",
    (name) => `Ciao! D'ora in poi parlerò con te in ${name}.`,
    "Cosa puoi fare", feats(F_IDS, F_ICONS, [
      ["Parla con l'equipaggio", "Parla o scrivi nella tua lingua — io traduco per l'equipaggio."],
      ["Richiedi servizi", "Acqua, cibo, una coperta e altro, a portata di tocco."],
      ["Capisci gli annunci", "Gli annunci dell'equipaggio appaiono come testo e immagini nella tua lingua."],
      ["Assistenza medica e speciale", "Di' all'equipaggio esattamente ciò di cui hai bisogno, anche sotto stress."],
      ["Comunicazione visiva", "Preferisci non parlare? Tocca le immagini invece."],
      ["Funziona offline", "Funziona sul sistema dell'aereo stesso — non serve internet."],
    ]),
    "Proviamo a fare una richiesta", "Scegline una per vedere come funziona.",
    scens(S_IDS, S_ICONS, ["Richiedi acqua", "Richiedi una coperta", "Chiedi assistenza"]),
    "Demo — non viene inviato nulla all'equipaggio", "Ecco come appare una richiesta reale",
    "Preferisci le immagini?", "Tocca qualsiasi immagine per richiederla — non serve scrivere o parlare.",
    "Capisci gli annunci", "Gli annunci dell'equipaggio appaiono così, nella tua lingua, con un'immagine.",
    "Rendilo comodo per te", "Puoi cambiare queste impostazioni in qualsiasi momento dalla schermata del tuo posto.",
    "Testo più grande", "Linguaggio semplice e immagini", "Leggi ad alta voce",
    "Tutto pronto!", "Ora puoi parlare comodamente con l'equipaggio. Sono qui ogni volta che hai bisogno di aiuto.",
    ["Lingua selezionata", "Funzionalità presentate", "Simulazione completata", "Preferenze impostate"], "Inizia a usare Auralink",
    "Riascolta", "Avanti", "Chiedi aiuto", "Rivedi il tutorial", "Avvia simulazione", "Traduzione per l'equipaggio…",
    "Tradotto per l'equipaggio", "L'equipaggio risponde", "Hai bisogno di aiuto? Toccami quando vuoi."),

  pt: L("Bem-vindo a bordo!", "Sou o seu assistente pessoal da Auralink. Vou mostrar-lhe como falar confortavelmente com a tripulação, seja qual for o seu idioma.",
    "Vamos começar", "Pular tutorial", "Escolha o seu idioma", "Pode mudar isto a qualquer momento no ecrã do seu lugar.",
    (name) => `Olá! A partir de agora falarei consigo em ${name}.`,
    "O que pode fazer", feats(F_IDS, F_ICONS, [
      ["Falar com a tripulação", "Fale ou digite no seu idioma — eu traduzo para a tripulação."],
      ["Solicitar serviços", "Água, comida, um cobertor e mais, a um toque de distância."],
      ["Entender os anúncios", "Os anúncios da tripulação aparecem como texto e imagens no seu idioma."],
      ["Ajuda médica e especial", "Diga à tripulação exatamente do que precisa, mesmo sob stress."],
      ["Comunicação visual", "Prefere não falar? Toque em imagens."],
      ["Funciona offline", "Funciona no próprio sistema da aeronave — não precisa de internet."],
    ]),
    "Vamos tentar pedir algo", "Escolha um para ver como funciona.",
    scens(S_IDS, S_ICONS, ["Pedir água", "Pedir um cobertor", "Pedir assistência"]),
    "Demo — nada é enviado à tripulação", "É assim que um pedido real se parece",
    "Prefere imagens?", "Toque em qualquer imagem para pedi-la — sem necessidade de digitar ou falar.",
    "Entender os anúncios", "Os anúncios da tripulação aparecem assim, no seu idioma, com uma imagem.",
    "Torne isto confortável para si", "Pode mudar isto a qualquer momento no ecrã do seu lugar.",
    "Texto maior", "Linguagem simples e imagens", "Ler em voz alta",
    "Está tudo pronto!", "Agora pode falar com a tripulação confortavelmente. Estou aqui sempre que precisar de ajuda.",
    ["Idioma selecionado", "Funcionalidades apresentadas", "Simulação concluída", "Preferências definidas"], "Começar a usar o Auralink",
    "Repetir", "Seguinte", "Pedir ajuda", "Rever tutorial", "Iniciar simulação", "A traduzir para a tripulação…",
    "Traduzido para a tripulação", "A tripulação responde", "Precisa de ajuda? Toque em mim quando quiser."),

  bn: L("স্বাগতম!", "আমি আপনার ব্যক্তিগত Auralink সহায়ক। আপনি যে ভাষাতেই কথা বলুন না কেন, আমি দেখাব কীভাবে কেবিন ক্রুর সাথে স্বাচ্ছন্দ্যে কথা বলবেন।",
    "শুরু করা যাক", "টিউটোরিয়াল এড়িয়ে যান", "আপনার ভাষা বেছে নিন", "আপনি যেকোনো সময় সিট স্ক্রিন থেকে এটি পরিবর্তন করতে পারেন।",
    (name) => `নমস্কার! এখন থেকে আমি আপনার সাথে ${name} ভাষায় কথা বলব।`,
    "আপনি কী করতে পারেন", feats(F_IDS, F_ICONS, [
      ["ক্রুর সাথে কথা বলুন", "আপনার ভাষায় বলুন বা টাইপ করুন — আমি ক্রুর জন্য অনুবাদ করি।"],
      ["সেবার অনুরোধ করুন", "পানি, খাবার, কম্বল এবং আরও অনেক কিছু, এক ট্যাপে।"],
      ["ঘোষণা বুঝুন", "ক্রুর ঘোষণা আপনার ভাষায় লেখা ও ছবি আকারে দেখানো হয়।"],
      ["চিকিৎসা ও বিশেষ সহায়তা", "চাপের মধ্যেও ক্রুকে ঠিক কী প্রয়োজন তা জানান।"],
      ["ছবির মাধ্যমে যোগাযোগ", "কথা বলতে চান না? পরিবর্তে ছবিতে ট্যাপ করুন।"],
      ["অফলাইনে কাজ করে", "এই বিমানের নিজস্ব সিস্টেমে চলে — ইন্টারনেট দরকার নেই।"],
    ]),
    "কিছু অনুরোধ করে দেখা যাক", "এটি কীভাবে কাজ করে দেখতে একটি বেছে নিন।",
    scens(S_IDS, S_ICONS, ["পানি চান", "কম্বল চান", "সহায়তা চান"]),
    "ডেমো — ক্রুকে কিছু পাঠানো হয়নি", "একটি আসল অনুরোধ এরকম দেখায়",
    "ছবি পছন্দ করেন?", "অনুরোধ করতে যেকোনো ছবিতে ট্যাপ করুন — টাইপ বা কথা বলার দরকার নেই।",
    "ঘোষণা বোঝা", "ক্রুর ঘোষণা আপনার ভাষায়, একটি ছবি সহ, এভাবে দেখা যায়।",
    "এটি আপনার জন্য আরামদায়ক করুন", "আপনি যেকোনো সময় সিট স্ক্রিন থেকে এগুলো পরিবর্তন করতে পারেন।",
    "বড় লেখা", "সহজ ভাষা ও ছবি", "জোরে পড়ুন",
    "আপনি প্রস্তুত!", "এখন আপনি আরামে কেবিন ক্রুর সাথে কথা বলতে পারেন। সাহায্যের প্রয়োজনে আমি এখানে আছি।",
    ["ভাষা নির্বাচিত হয়েছে", "বৈশিষ্ট্যগুলি পরিচিত করানো হয়েছে", "ডেমো সম্পন্ন হয়েছে", "পছন্দসমূহ সেট করা হয়েছে"], "Auralink ব্যবহার শুরু করুন",
    "আবার শুনুন", "পরবর্তী", "সাহায্য চান", "টিউটোরিয়াল আবার দেখুন", "সিমুলেশন শুরু করুন", "ক্রুর জন্য অনুবাদ হচ্ছে…",
    "ক্রুর জন্য অনুবাদ হয়েছে", "ক্রুর উত্তর", "সাহায্য দরকার? যেকোনো সময় আমাকে ট্যাপ করুন।"),

  te: L("స్వాగతం!", "నేను మీ వ్యక్తిగత Auralink సహాయకుడిని. మీరు ఏ భాష మాట్లాడినా, క్యాబిన్ క్రూతో హాయిగా ఎలా మాట్లాడాలో చూపిస్తాను.",
    "ప్రారంభిద్దాం", "ట్యుటోరియల్ దాటవేయండి", "మీ భాషను ఎంచుకోండి", "మీరు దీన్ని సీట్ స్క్రీన్ నుండి ఎప్పుడైనా మార్చుకోవచ్చు.",
    (name) => `నమస్కారం! ఇప్పటి నుండి నేను మీతో ${name}లో మాట్లాడతాను.`,
    "మీరు ఏమి చేయగలరు", feats(F_IDS, F_ICONS, [
      ["క్రూతో మాట్లాడండి", "మీ భాషలో మాట్లాడండి లేదా టైప్ చేయండి — నేను క్రూ కోసం అనువదిస్తాను."],
      ["సేవలను అభ్యర్థించండి", "నీరు, ఆహారం, దుప్పటి మరియు మరిన్ని, ఒక్క టాప్‌లో."],
      ["ప్రకటనలను అర్థం చేసుకోండి", "క్రూ ప్రకటనలు మీ భాషలో వచనం మరియు చిత్రాలుగా చూపబడతాయి."],
      ["వైద్య మరియు ప్రత్యేక సహాయం", "ఒత్తిడిలో కూడా క్రూకు మీకు ఏమి కావాలో ఖచ్చితంగా చెప్పండి."],
      ["దృశ్య సంభాషణ", "మాట్లాడకూడదనుకుంటున్నారా? బదులుగా చిత్రాలపై టాప్ చేయండి."],
      ["ఆఫ్‌లైన్‌లో పనిచేస్తుంది", "ఈ విమానం యొక్క స్వంత వ్యవస్థలో నడుస్తుంది — ఇంటర్నెట్ అవసరం లేదు."],
    ]),
    "ఏదైనా అభ్యర్థించి చూద్దాం", "ఇది ఎలా పనిచేస్తుందో చూడటానికి ఒకటి ఎంచుకోండి.",
    scens(S_IDS, S_ICONS, ["నీరు అడగండి", "దుప్పటి అడగండి", "సహాయం అడగండి"]),
    "డెమో — క్రూకు ఏమీ పంపబడలేదు", "నిజమైన అభ్యర్థన ఇలా కనిపిస్తుంది",
    "చిత్రాలు ఇష్టమా?", "అభ్యర్థించడానికి ఏదైనా చిత్రంపై టాప్ చేయండి — టైప్ చేయడం లేదా మాట్లాడటం అవసరం లేదు.",
    "ప్రకటనలను అర్థం చేసుకోవడం", "క్రూ ప్రకటనలు మీ భాషలో, ఒక చిత్రంతో, ఇలా కనిపిస్తాయి.",
    "దీన్ని మీకు సౌకర్యవంతంగా చేసుకోండి", "మీరు వీటిని సీట్ స్క్రీన్ నుండి ఎప్పుడైనా మార్చుకోవచ్చు.",
    "పెద్ద అక్షరాలు", "సరళమైన భాష & చిత్రాలు", "బిగ్గరగా చదవండి",
    "మీరు సిద్ధంగా ఉన్నారు!", "ఇప్పుడు మీరు మీ క్యాబిన్ క్రూతో హాయిగా మాట్లాడవచ్చు. సహాయం కావాలంటే నేను ఇక్కడ ఉన్నాను.",
    ["భాష ఎంపిక చేయబడింది", "ఫీచర్లు పరిచయం చేయబడ్డాయి", "డెమో పూర్తయింది", "ప్రాధాన్యతలు సెట్ చేయబడ్డాయి"], "Auralink వాడటం ప్రారంభించండి",
    "మళ్ళీ వినండి", "తదుపరి", "సహాయం అడగండి", "ట్యుటోరియల్ మళ్ళీ చూడండి", "సిమ్యులేషన్ ప్రారంభించండి", "క్రూ కోసం అనువదిస్తోంది…",
    "క్రూ కోసం అనువదించబడింది", "క్రూ సమాధానం", "సహాయం కావాలా? ఎప్పుడైనా నన్ను టాప్ చేయండి."),

  mr: L("स्वागत आहे!", "मी तुमचा वैयक्तिक Auralink सहाय्यक आहे. तुम्ही कोणतीही भाषा बोलत असाल, मी तुम्हाला केबिन क्रूशी आरामात कसे बोलायचे ते दाखवेन.",
    "सुरुवात करूया", "ट्युटोरियल वगळा", "तुमची भाषा निवडा", "तुम्ही हे सीट स्क्रीनवरून केव्हाही बदलू शकता.",
    (name) => `नमस्कार! आतापासून मी तुमच्याशी ${name} मध्ये बोलेन.`,
    "तुम्ही काय करू शकता", feats(F_IDS, F_ICONS, [
      ["क्रूशी बोला", "तुमच्या भाषेत बोला किंवा टाइप करा — मी क्रूसाठी भाषांतर करतो."],
      ["सेवांची विनंती करा", "पाणी, अन्न, ब्लँकेट आणि बरेच काही, एका टॅपमध्ये."],
      ["घोषणा समजून घ्या", "क्रूच्या घोषणा तुमच्या भाषेत मजकूर आणि चित्रे म्हणून दाखवल्या जातात."],
      ["वैद्यकीय व विशेष मदत", "तणावातही क्रूला नेमके काय हवे आहे ते सांगा."],
      ["दृश्य संवाद", "बोलायचे नाही? त्याऐवजी चित्रांवर टॅप करा."],
      ["ऑफलाइन काम करते", "या विमानाच्या स्वतःच्या यंत्रणेवर चालते — इंटरनेटची गरज नाही."],
    ]),
    "काहीतरी विनंती करून पाहूया", "हे कसे कार्य करते हे पाहण्यासाठी एक निवडा.",
    scens(S_IDS, S_ICONS, ["पाणी मागा", "ब्लँकेट मागा", "मदत मागा"]),
    "डेमो — क्रूला काहीही पाठवले गेलेले नाही", "खरी विनंती अशी दिसते",
    "चित्रे आवडतात?", "विनंती करण्यासाठी कोणत्याही चित्रावर टॅप करा — टाइप किंवा बोलण्याची गरज नाही.",
    "घोषणा समजून घेणे", "क्रूच्या घोषणा तुमच्या भाषेत, चित्रासह, अशा दिसतात.",
    "हे तुमच्यासाठी आरामदायक करा", "तुम्ही हे सीट स्क्रीनवरून केव्हाही बदलू शकता.",
    "मोठा मजकूर", "सोपी भाषा आणि चित्रे", "मोठ्याने वाचा",
    "तुम्ही तयार आहात!", "आता तुम्ही तुमच्या केबिन क्रूशी आरामात बोलू शकता. मदत हवी असेल तेव्हा मी इथे आहे.",
    ["भाषा निवडली गेली", "वैशिष्ट्ये ओळख करून दिली", "डेमो पूर्ण झाला", "प्राधान्ये सेट केली"], "Auralink वापरणे सुरू करा",
    "पुन्हा ऐका", "पुढे", "मदत मागा", "ट्युटोरियल पुन्हा पहा", "सिम्युलेशन सुरू करा", "क्रूसाठी भाषांतर होत आहे…",
    "क्रूसाठी भाषांतरित केले", "क्रूचे उत्तर", "मदत हवी आहे? मला केव्हाही टॅप करा."),

  gu: L("સ્વાગત છે!", "હું તમારો વ્યક્તિગત Auralink સહાયક છું. તમે ગમે તે ભાષા બોલતા હોવ, હું તમને કેબિન ક્રૂ સાથે આરામથી કેવી રીતે વાત કરવી તે બતાવીશ.",
    "ચાલો શરૂ કરીએ", "ટ્યુટોરિયલ છોડો", "તમારી ભાષા પસંદ કરો", "તમે આ ગમે ત્યારે સીટ સ્ક્રીનથી બદલી શકો છો.",
    (name) => `નમસ્તે! હવેથી હું તમારી સાથે ${name} માં વાત કરીશ.`,
    "તમે શું કરી શકો છો", feats(F_IDS, F_ICONS, [
      ["ક્રૂ સાથે વાત કરો", "તમારી ભાષામાં બોલો અથવા ટાઇપ કરો — હું ક્રૂ માટે અનુવાદ કરું છું."],
      ["સેવાઓ માટે વિનંતી કરો", "પાણી, ખોરાક, ધાબળો અને વધુ, એક ટેપમાં."],
      ["જાહેરાતો સમજો", "ક્રૂની જાહેરાતો તમારી ભાષામાં ટેક્સ્ટ અને ચિત્રો તરીકે બતાવાય છે."],
      ["તબીબી અને વિશેષ સહાય", "તણાવમાં પણ ક્રૂને બરાબર શું જોઈએ છે તે જણાવો."],
      ["દ્રશ્ય સંચાર", "બોલવા નથી માંગતા? તેના બદલે ચિત્રો પર ટેપ કરો."],
      ["ઓફલાઇન કામ કરે છે", "આ વિમાનની પોતાની સિસ્ટમ પર ચાલે છે — ઇન્ટરનેટની જરૂર નથી."],
    ]),
    "કંઈક વિનંતી કરીને જોઈએ", "તે કેવી રીતે કાર્ય કરે છે તે જોવા માટે એક પસંદ કરો.",
    scens(S_IDS, S_ICONS, ["પાણી માંગો", "ધાબળો માંગો", "સહાય માંગો"]),
    "ડેમો — ક્રૂને કંઈ મોકલાયું નથી", "સાચી વિનંતી આવી દેખાય છે",
    "ચિત્રો પસંદ છે?", "વિનંતી કરવા કોઈપણ ચિત્ર પર ટેપ કરો — ટાઇપ અથવા બોલવાની જરૂર નથી.",
    "જાહેરાતો સમજવી", "ક્રૂની જાહેરાતો તમારી ભાષામાં, ચિત્ર સાથે, આ રીતે દેખાય છે.",
    "તેને તમારા માટે આરામદાયક બનાવો", "તમે આને ગમે ત્યારે સીટ સ્ક્રીનથી બદલી શકો છો.",
    "મોટું લખાણ", "સરળ ભાષા અને ચિત્રો", "મોટેથી વાંચો",
    "તમે તૈયાર છો!", "હવે તમે તમારા કેબિન ક્રૂ સાથે આરામથી વાત કરી શકો છો. મદદની જરૂર હોય ત્યારે હું અહીં છું.",
    ["ભાષા પસંદ કરાઈ", "સુવિધાઓ રજૂ કરાઈ", "ડેમો પૂર્ણ થયો", "પસંદગીઓ સેટ કરાઈ"], "Auralink વાપરવાનું શરૂ કરો",
    "ફરી સાંભળો", "આગળ", "મદદ માંગો", "ટ્યુટોરિયલ ફરી જુઓ", "સિમ્યુલેશન શરૂ કરો", "ક્રૂ માટે અનુવાદ થઈ રહ્યો છે…",
    "ક્રૂ માટે અનુવાદિત", "ક્રૂનો જવાબ", "મદદ જોઈએ છે? મને ગમે ત્યારે ટેપ કરો."),

  kn: L("ಸ್ವಾಗತ!", "ನಾನು ನಿಮ್ಮ ವೈಯಕ್ತಿಕ Auralink ಸಹಾಯಕ. ನೀವು ಯಾವ ಭಾಷೆ ಮಾತನಾಡಿದರೂ, ಕ್ಯಾಬಿನ್ ಕ್ರೂ ಜೊತೆ ಆರಾಮವಾಗಿ ಮಾತನಾಡುವುದು ಹೇಗೆ ಎಂದು ತೋರಿಸುತ್ತೇನೆ.",
    "ಪ್ರಾರಂಭಿಸೋಣ", "ಟ್ಯುಟೋರಿಯಲ್ ಬಿಟ್ಟುಬಿಡಿ", "ನಿಮ್ಮ ಭಾಷೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ", "ನೀವು ಇದನ್ನು ಸೀಟ್ ಪರದೆಯಿಂದ ಯಾವುದೇ ಸಮಯದಲ್ಲಿ ಬದಲಾಯಿಸಬಹುದು.",
    (name) => `ನಮಸ್ಕಾರ! ಇನ್ನು ಮುಂದೆ ನಾನು ನಿಮ್ಮೊಂದಿಗೆ ${name} ಭಾಷೆಯಲ್ಲಿ ಮಾತನಾಡುತ್ತೇನೆ.`,
    "ನೀವು ಏನು ಮಾಡಬಹುದು", feats(F_IDS, F_ICONS, [
      ["ಕ್ರೂ ಜೊತೆ ಮಾತನಾಡಿ", "ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ ಮಾತನಾಡಿ ಅಥವಾ ಟೈಪ್ ಮಾಡಿ — ನಾನು ಕ್ರೂಗಾಗಿ ಅನುವಾದಿಸುತ್ತೇನೆ."],
      ["ಸೇವೆಗಳನ್ನು ವಿನಂತಿಸಿ", "ನೀರು, ಆಹಾರ, ಹೊದಿಕೆ ಮತ್ತು ಇನ್ನಷ್ಟು, ಒಂದು ಟ್ಯಾಪ್‌ನಲ್ಲಿ."],
      ["ಪ್ರಕಟಣೆಗಳನ್ನು ಅರ್ಥಮಾಡಿಕೊಳ್ಳಿ", "ಕ್ರೂ ಪ್ರಕಟಣೆಗಳು ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ ಪಠ್ಯ ಮತ್ತು ಚಿತ್ರಗಳಾಗಿ ತೋರಿಸಲಾಗುತ್ತದೆ."],
      ["ವೈದ್ಯಕೀಯ ಮತ್ತು ವಿಶೇಷ ಸಹಾಯ", "ಒತ್ತಡದಲ್ಲಿಯೂ ಕ್ರೂಗೆ ನಿಮಗೆ ಏನು ಬೇಕು ಎಂದು ನಿಖರವಾಗಿ ತಿಳಿಸಿ."],
      ["ದೃಶ್ಯ ಸಂವಹನ", "ಮಾತನಾಡಲು ಇಷ್ಟವಿಲ್ಲವೇ? ಬದಲಿಗೆ ಚಿತ್ರಗಳನ್ನು ಟ್ಯಾಪ್ ಮಾಡಿ."],
      ["ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿ ಕಾರ್ಯನಿರ್ವಹಿಸುತ್ತದೆ", "ಈ ವಿಮಾನದ ಸ್ವಂತ ವ್ಯವಸ್ಥೆಯಲ್ಲಿ ಚಾಲನೆಯಾಗುತ್ತದೆ — ಇಂಟರ್ನೆಟ್ ಅಗತ್ಯವಿಲ್ಲ."],
    ]),
    "ಏನಾದರೂ ವಿನಂತಿಸಿ ನೋಡೋಣ", "ಇದು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ ಎಂದು ನೋಡಲು ಒಂದನ್ನು ಆಯ್ಕೆಮಾಡಿ.",
    scens(S_IDS, S_ICONS, ["ನೀರು ಕೇಳಿ", "ಹೊದಿಕೆ ಕೇಳಿ", "ಸಹಾಯ ಕೇಳಿ"]),
    "ಡೆಮೊ — ಕ್ರೂಗೆ ಏನೂ ಕಳುಹಿಸಲಾಗಿಲ್ಲ", "ನೈಜ ವಿನಂತಿ ಹೀಗೆ ಕಾಣುತ್ತದೆ",
    "ಚಿತ್ರಗಳು ಇಷ್ಟವೇ?", "ವಿನಂತಿಸಲು ಯಾವುದೇ ಚಿತ್ರವನ್ನು ಟ್ಯಾಪ್ ಮಾಡಿ — ಟೈಪ್ ಅಥವಾ ಮಾತನಾಡುವ ಅಗತ್ಯವಿಲ್ಲ.",
    "ಪ್ರಕಟಣೆಗಳನ್ನು ಅರ್ಥಮಾಡಿಕೊಳ್ಳುವುದು", "ಕ್ರೂ ಪ್ರಕಟಣೆಗಳು ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ, ಚಿತ್ರದೊಂದಿಗೆ, ಹೀಗೆ ಕಾಣಿಸುತ್ತವೆ.",
    "ಇದನ್ನು ನಿಮಗಾಗಿ ಆರಾಮದಾಯಕಗೊಳಿಸಿ", "ನೀವು ಇವುಗಳನ್ನು ಸೀಟ್ ಪರದೆಯಿಂದ ಯಾವುದೇ ಸಮಯದಲ್ಲಿ ಬದಲಾಯಿಸಬಹುದು.",
    "ದೊಡ್ಡ ಪಠ್ಯ", "ಸರಳ ಭಾಷೆ ಮತ್ತು ಚಿತ್ರಗಳು", "ಗಟ್ಟಿಯಾಗಿ ಓದಿ",
    "ನೀವು ಸಿದ್ಧರಿದ್ದೀರಿ!", "ಈಗ ನೀವು ನಿಮ್ಮ ಕ್ಯಾಬಿನ್ ಕ್ರೂ ಜೊತೆ ಆರಾಮವಾಗಿ ಮಾತನಾಡಬಹುದು. ಸಹಾಯ ಬೇಕಾದಾಗ ನಾನು ಇಲ್ಲಿದ್ದೇನೆ.",
    ["ಭಾಷೆ ಆಯ್ಕೆಮಾಡಲಾಗಿದೆ", "ವೈಶಿಷ್ಟ್ಯಗಳನ್ನು ಪರಿಚಯಿಸಲಾಗಿದೆ", "ಡೆಮೊ ಪೂರ್ಣಗೊಂಡಿದೆ", "ಆದ್ಯತೆಗಳನ್ನು ಹೊಂದಿಸಲಾಗಿದೆ"], "Auralink ಬಳಸಲು ಪ್ರಾರಂಭಿಸಿ",
    "ಮತ್ತೆ ಕೇಳಿ", "ಮುಂದೆ", "ಸಹಾಯ ಕೇಳಿ", "ಟ್ಯುಟೋರಿಯಲ್ ಮತ್ತೆ ನೋಡಿ", "ಸಿಮ್ಯುಲೇಶನ್ ಪ್ರಾರಂಭಿಸಿ", "ಕ್ರೂಗಾಗಿ ಅನುವಾದಿಸಲಾಗುತ್ತಿದೆ…",
    "ಕ್ರೂಗಾಗಿ ಅನುವಾದಿಸಲಾಗಿದೆ", "ಕ್ರೂ ಪ್ರತಿಕ್ರಿಯೆ", "ಸಹಾಯ ಬೇಕೇ? ಯಾವಾಗ ಬೇಕಾದರೂ ನನ್ನನ್ನು ಟ್ಯಾಪ್ ಮಾಡಿ."),

  ml: L("സ്വാഗതം!", "ഞാൻ നിങ്ങളുടെ വ്യക്തിഗത Auralink സഹായി ആണ്. നിങ്ങൾ ഏത് ഭാഷ സംസാരിച്ചാലും, ക്യാബിൻ ക്രൂവുമായി സൗകര്യപ്രദമായി സംസാരിക്കുന്നത് എങ്ങനെയെന്ന് ഞാൻ കാണിക്കാം.",
    "നമുക്ക് തുടങ്ങാം", "ട്യൂട്ടോറിയൽ ഒഴിവാക്കുക", "നിങ്ങളുടെ ഭാഷ തിരഞ്ഞെടുക്കുക", "നിങ്ങൾക്ക് ഇത് എപ്പോൾ വേണമെങ്കിലും സീറ്റ് സ്ക്രീനിൽ നിന്ന് മാറ്റാം.",
    (name) => `നമസ്കാരം! ഇനി മുതൽ ഞാൻ നിങ്ങളോട് ${name}ൽ സംസാരിക്കും.`,
    "നിങ്ങൾക്ക് എന്ത് ചെയ്യാം", feats(F_IDS, F_ICONS, [
      ["ക്രൂവുമായി സംസാരിക്കുക", "നിങ്ങളുടെ ഭാഷയിൽ സംസാരിക്കുക അല്ലെങ്കിൽ ടൈപ്പ് ചെയ്യുക — ഞാൻ ക്രൂവിനായി വിവർത്തനം ചെയ്യും."],
      ["സേവനങ്ങൾ അഭ്യർത്ഥിക്കുക", "വെള്ളം, ഭക്ഷണം, പുതപ്പ് തുടങ്ങിയവ, ഒരു ടാപ്പിൽ."],
      ["അറിയിപ്പുകൾ മനസ്സിലാക്കുക", "ക്രൂ അറിയിപ്പുകൾ നിങ്ങളുടെ ഭാഷയിൽ ടെക്സ്റ്റും ചിത്രങ്ങളുമായി കാണിക്കും."],
      ["മെഡിക്കൽ & പ്രത്യേക സഹായം", "സമ്മർദ്ദത്തിലും ക്രൂവിനോട് നിങ്ങൾക്ക് എന്താണ് വേണ്ടതെന്ന് കൃത്യമായി പറയുക."],
      ["ദൃശ്യ ആശയവിനിമയം", "സംസാരിക്കാൻ താൽപ്പര്യമില്ലേ? പകരം ചിത്രങ്ങളിൽ ടാപ്പ് ചെയ്യുക."],
      ["ഓഫ്‌ലൈനിൽ പ്രവർത്തിക്കുന്നു", "ഈ വിമാനത്തിന്റെ സ്വന്തം സിസ്റ്റത്തിൽ പ്രവർത്തിക്കുന്നു — ഇന്റർനെറ്റ് ആവശ്യമില്ല."],
    ]),
    "എന്തെങ്കിലും അഭ്യർത്ഥിച്ച് നോക്കാം", "ഇത് എങ്ങനെ പ്രവർത്തിക്കുന്നുവെന്ന് കാണാൻ ഒന്ന് തിരഞ്ഞെടുക്കുക.",
    scens(S_IDS, S_ICONS, ["വെള്ളം ആവശ്യപ്പെടുക", "പുതപ്പ് ആവശ്യപ്പെടുക", "സഹായം ആവശ്യപ്പെടുക"]),
    "ഡെമോ — ക്രൂവിന് ഒന്നും അയച്ചിട്ടില്ല", "ഒരു യഥാർത്ഥ അഭ്യർത്ഥന ഇങ്ങനെയാണ് കാണപ്പെടുന്നത്",
    "ചിത്രങ്ങൾ ഇഷ്ടമാണോ?", "അഭ്യർത്ഥിക്കാൻ ഏതെങ്കിലും ചിത്രത്തിൽ ടാപ്പ് ചെയ്യുക — ടൈപ്പ് ചെയ്യുകയോ സംസാരിക്കുകയോ വേണ്ട.",
    "അറിയിപ്പുകൾ മനസ്സിലാക്കൽ", "ക്രൂ അറിയിപ്പുകൾ നിങ്ങളുടെ ഭാഷയിൽ, ഒരു ചിത്രത്തോടൊപ്പം, ഇങ്ങനെ കാണപ്പെടും.",
    "ഇത് നിങ്ങൾക്ക് സൗകര്യപ്രദമാക്കുക", "നിങ്ങൾക്ക് ഇവ എപ്പോൾ വേണമെങ്കിലും സീറ്റ് സ്ക്രീനിൽ നിന്ന് മാറ്റാം.",
    "വലിയ ടെക്സ്റ്റ്", "ലളിതമായ ഭാഷയും ചിത്രങ്ങളും", "ഉറക്കെ വായിക്കുക",
    "നിങ്ങൾ തയ്യാറാണ്!", "ഇപ്പോൾ നിങ്ങൾക്ക് ക്യാബിൻ ക്രൂവുമായി സൗകര്യപ്രദമായി സംസാരിക്കാം. സഹായം വേണ്ടപ്പോഴെല്ലാം ഞാൻ ഇവിടെയുണ്ട്.",
    ["ഭാഷ തിരഞ്ഞെടുത്തു", "ഫീച്ചറുകൾ പരിചയപ്പെടുത്തി", "ഡെമോ പൂർത്തിയായി", "മുൻഗണനകൾ സജ്ജമാക്കി"], "Auralink ഉപയോഗിക്കാൻ തുടങ്ങുക",
    "വീണ്ടും കേൾക്കുക", "അടുത്തത്", "സഹായം ചോദിക്കുക", "ട്യൂട്ടോറിയൽ വീണ്ടും കാണുക", "സിമുലേഷൻ ആരംഭിക്കുക", "ക്രൂവിനായി വിവർത്തനം ചെയ്യുന്നു…",
    "ക്രൂവിനായി വിവർത്തനം ചെയ്തു", "ക്രൂ മറുപടി", "സഹായം വേണോ? എപ്പോൾ വേണമെങ്കിലും എന്നെ ടാപ്പ് ചെയ്യുക."),

  pa: L("ਜੀ ਆਇਆਂ ਨੂੰ!", "ਮੈਂ ਤੁਹਾਡਾ ਨਿੱਜੀ Auralink ਸਹਾਇਕ ਹਾਂ। ਤੁਸੀਂ ਕੋਈ ਵੀ ਭਾਸ਼ਾ ਬੋਲੋ, ਮੈਂ ਦਿਖਾਵਾਂਗਾ ਕਿ ਕੈਬਿਨ ਕਰੂ ਨਾਲ ਆਰਾਮ ਨਾਲ ਕਿਵੇਂ ਗੱਲ ਕਰਨੀ ਹੈ।",
    "ਸ਼ੁਰੂ ਕਰੀਏ", "ਟਿਊਟੋਰਿਅਲ ਛੱਡੋ", "ਆਪਣੀ ਭਾਸ਼ਾ ਚੁਣੋ", "ਤੁਸੀਂ ਇਸਨੂੰ ਕਿਸੇ ਵੀ ਸਮੇਂ ਸੀਟ ਸਕ੍ਰੀਨ ਤੋਂ ਬਦਲ ਸਕਦੇ ਹੋ।",
    (name) => `ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ! ਹੁਣ ਤੋਂ ਮੈਂ ਤੁਹਾਡੇ ਨਾਲ ${name} ਵਿੱਚ ਗੱਲ ਕਰਾਂਗਾ।`,
    "ਤੁਸੀਂ ਕੀ ਕਰ ਸਕਦੇ ਹੋ", feats(F_IDS, F_ICONS, [
      ["ਕਰੂ ਨਾਲ ਗੱਲ ਕਰੋ", "ਆਪਣੀ ਭਾਸ਼ਾ ਵਿੱਚ ਬੋਲੋ ਜਾਂ ਟਾਈਪ ਕਰੋ — ਮੈਂ ਕਰੂ ਲਈ ਅਨੁਵਾਦ ਕਰਦਾ ਹਾਂ।"],
      ["ਸੇਵਾਵਾਂ ਦੀ ਬੇਨਤੀ ਕਰੋ", "ਪਾਣੀ, ਭੋਜਨ, ਕੰਬਲ ਅਤੇ ਹੋਰ, ਇੱਕ ਟੈਪ ਵਿੱਚ।"],
      ["ਘੋਸ਼ਣਾਵਾਂ ਸਮਝੋ", "ਕਰੂ ਦੀਆਂ ਘੋਸ਼ਣਾਵਾਂ ਤੁਹਾਡੀ ਭਾਸ਼ਾ ਵਿੱਚ ਲਿਖਤ ਅਤੇ ਤਸਵੀਰਾਂ ਵਜੋਂ ਦਿਖਾਈਆਂ ਜਾਂਦੀਆਂ ਹਨ।"],
      ["ਮੈਡੀਕਲ ਅਤੇ ਖਾਸ ਮਦਦ", "ਤਣਾਅ ਵਿੱਚ ਵੀ ਕਰੂ ਨੂੰ ਦੱਸੋ ਕਿ ਤੁਹਾਨੂੰ ਕੀ ਚਾਹੀਦਾ ਹੈ।"],
      ["ਦ੍ਰਿਸ਼ ਸੰਚਾਰ", "ਬੋਲਣਾ ਨਹੀਂ ਚਾਹੁੰਦੇ? ਇਸ ਦੀ ਬਜਾਏ ਤਸਵੀਰਾਂ 'ਤੇ ਟੈਪ ਕਰੋ।"],
      ["ਆਫਲਾਈਨ ਕੰਮ ਕਰਦਾ ਹੈ", "ਇਸ ਜਹਾਜ਼ ਦੇ ਆਪਣੇ ਸਿਸਟਮ 'ਤੇ ਚੱਲਦਾ ਹੈ — ਇੰਟਰਨੈਟ ਦੀ ਲੋੜ ਨਹੀਂ।"],
    ]),
    "ਕੁਝ ਬੇਨਤੀ ਕਰਕੇ ਵੇਖੀਏ", "ਇਹ ਕਿਵੇਂ ਕੰਮ ਕਰਦਾ ਹੈ ਵੇਖਣ ਲਈ ਇੱਕ ਚੁਣੋ।",
    scens(S_IDS, S_ICONS, ["ਪਾਣੀ ਮੰਗੋ", "ਕੰਬਲ ਮੰਗੋ", "ਮਦਦ ਮੰਗੋ"]),
    "ਡੈਮੋ — ਕਰੂ ਨੂੰ ਕੁਝ ਨਹੀਂ ਭੇਜਿਆ ਗਿਆ", "ਇੱਕ ਅਸਲੀ ਬੇਨਤੀ ਇਸ ਤਰ੍ਹਾਂ ਦਿਖਦੀ ਹੈ",
    "ਤਸਵੀਰਾਂ ਪਸੰਦ ਹਨ?", "ਬੇਨਤੀ ਕਰਨ ਲਈ ਕਿਸੇ ਵੀ ਤਸਵੀਰ 'ਤੇ ਟੈਪ ਕਰੋ — ਟਾਈਪ ਜਾਂ ਬੋਲਣ ਦੀ ਲੋੜ ਨਹੀਂ।",
    "ਘੋਸ਼ਣਾਵਾਂ ਸਮਝਣਾ", "ਕਰੂ ਦੀਆਂ ਘੋਸ਼ਣਾਵਾਂ ਤੁਹਾਡੀ ਭਾਸ਼ਾ ਵਿੱਚ, ਇੱਕ ਤਸਵੀਰ ਨਾਲ, ਇਸ ਤਰ੍ਹਾਂ ਦਿਖਦੀਆਂ ਹਨ।",
    "ਇਸਨੂੰ ਆਪਣੇ ਲਈ ਆਰਾਮਦਾਇਕ ਬਣਾਓ", "ਤੁਸੀਂ ਇਹਨਾਂ ਨੂੰ ਕਿਸੇ ਵੀ ਸਮੇਂ ਸੀਟ ਸਕ੍ਰੀਨ ਤੋਂ ਬਦਲ ਸਕਦੇ ਹੋ।",
    "ਵੱਡਾ ਟੈਕਸਟ", "ਸਰਲ ਭਾਸ਼ਾ ਅਤੇ ਤਸਵੀਰਾਂ", "ਉੱਚੀ ਆਵਾਜ਼ ਵਿੱਚ ਪੜ੍ਹੋ",
    "ਤੁਸੀਂ ਤਿਆਰ ਹੋ!", "ਹੁਣ ਤੁਸੀਂ ਆਪਣੇ ਕੈਬਿਨ ਕਰੂ ਨਾਲ ਆਰਾਮ ਨਾਲ ਗੱਲ ਕਰ ਸਕਦੇ ਹੋ। ਜਦੋਂ ਵੀ ਮਦਦ ਚਾਹੀਦੀ ਹੋਵੇ, ਮੈਂ ਇੱਥੇ ਹਾਂ।",
    ["ਭਾਸ਼ਾ ਚੁਣੀ ਗਈ", "ਵਿਸ਼ੇਸ਼ਤਾਵਾਂ ਪੇਸ਼ ਕੀਤੀਆਂ ਗਈਆਂ", "ਡੈਮੋ ਪੂਰਾ ਹੋਇਆ", "ਤਰਜੀਹਾਂ ਸੈੱਟ ਕੀਤੀਆਂ ਗਈਆਂ"], "Auralink ਵਰਤਣਾ ਸ਼ੁਰੂ ਕਰੋ",
    "ਫਿਰ ਸੁਣੋ", "ਅੱਗੇ", "ਮਦਦ ਮੰਗੋ", "ਟਿਊਟੋਰਿਅਲ ਫਿਰ ਵੇਖੋ", "ਸਿਮੂਲੇਸ਼ਨ ਸ਼ੁਰੂ ਕਰੋ", "ਕਰੂ ਲਈ ਅਨੁਵਾਦ ਹੋ ਰਿਹਾ ਹੈ…",
    "ਕਰੂ ਲਈ ਅਨੁਵਾਦ ਕੀਤਾ ਗਿਆ", "ਕਰੂ ਦਾ ਜਵਾਬ", "ਮਦਦ ਚਾਹੀਦੀ ਹੈ? ਮੈਨੂੰ ਕਿਸੇ ਵੀ ਸਮੇਂ ਟੈਪ ਕਰੋ।"),
};

const DEMO_REPLIES = {
  water: {
    en: ["I need water, please.", "Bringing it right away."],
    hi: ["मुझे पानी चाहिए।", "अभी लेकर आ रहे हैं।"],
    ta: ["எனக்கு தண்ணீர் வேண்டும்.", "இப்போதே கொண்டு வருகிறோம்."],
    th: ["ฉันต้องการน้ำค่ะ", "กำลังนำมาให้ทันทีค่ะ"],
    zh: ["我需要水，谢谢。", "马上为您送来。"],
    es: ["Necesito agua, por favor.", "Se lo traigo enseguida."],
    fr: ["J'ai besoin d'eau, s'il vous plaît.", "Je l'apporte tout de suite."],
    it: ["Ho bisogno di acqua, per favore.", "Te la porto subito."],
    pt: ["Preciso de água, por favor.", "Vou trazer já."],
    bn: ["আমার পানি দরকার।", "এখনই নিয়ে আসছি।"],
    te: ["నాకు నీరు కావాలి.", "వెంటనే తీసుకువస్తున్నాము."],
    mr: ["मला पाणी हवे आहे.", "लगेच घेऊन येत आहोत."],
    gu: ["મારે પાણી જોઈએ છે.", "હમણાં જ લાવીએ છીએ."],
    kn: ["ನನಗೆ ನೀರು ಬೇಕು.", "ಈಗಲೇ ತರುತ್ತಿದ್ದೇವೆ."],
    ml: ["എനിക്ക് വെള്ളം വേണം.", "ഉടൻ കൊണ്ടുവരുന്നു."],
    pa: ["ਮੈਨੂੰ ਪਾਣੀ ਚਾਹੀਦਾ ਹੈ।", "ਹੁਣੇ ਲੈ ਕੇ ਆ ਰਹੇ ਹਾਂ।"],
  },
  blanket: {
    en: ["Could I have a blanket, please?", "Bringing it right away."],
    hi: ["क्या मुझे कंबल मिल सकता है?", "अभी लेकर आ रहे हैं।"],
    ta: ["எனக்கு ஒரு போர்வை கிடைக்குமா?", "இப்போதே கொண்டு வருகிறோம்."],
    th: ["ขอผ้าห่มได้ไหมคะ", "กำลังนำมาให้ทันทีค่ะ"],
    zh: ["可以给我一条毯子吗？", "马上为您送来。"],
    es: ["¿Podría tener una manta, por favor?", "Se la traigo enseguida."],
    fr: ["Pourrais-je avoir une couverture, s'il vous plaît ?", "Je l'apporte tout de suite."],
    it: ["Potrei avere una coperta, per favore?", "Te la porto subito."],
    pt: ["Pode trazer-me um cobertor, por favor?", "Vou trazer já."],
    bn: ["আমি কি একটা কম্বল পেতে পারি?", "এখনই নিয়ে আসছি।"],
    te: ["నాకు ఒక దుప్పటి ఇవ్వగలరా?", "వెంటనే తీసుకువస్తున్నాము."],
    mr: ["मला ब्लँकेट मिळेल का?", "लगेच घेऊन येत आहोत."],
    gu: ["શું મને ધાબળો મળી શકે?", "હમણાં જ લાવીએ છીએ."],
    kn: ["ನನಗೆ ಒಂದು ಹೊದಿಕೆ ಸಿಗಬಹುದೇ?", "ಈಗಲೇ ತರುತ್ತಿದ್ದೇವೆ."],
    ml: ["എനിക്ക് ഒരു പുതപ്പ് കിട്ടുമോ?", "ഉടൻ കൊണ്ടുവരുന്നു."],
    pa: ["ਕੀ ਮੈਨੂੰ ਇੱਕ ਕੰਬਲ ਮਿਲ ਸਕਦਾ ਹੈ?", "ਹੁਣੇ ਲੈ ਕੇ ਆ ਰਹੇ ਹਾਂ।"],
  },
  medical: {
    en: ["I'm not feeling well.", "A crew member is coming to help you now."],
    hi: ["मेरी तबीयत ठीक नहीं है।", "चालक दल का सदस्य अभी आपकी मदद के लिए आ रहा है।"],
    ta: ["எனக்கு உடல்நிலை சரியில்லை.", "பணியாளர் இப்போதே உங்களுக்கு உதவ வருகிறார்."],
    th: ["ฉันรู้สึกไม่สบายค่ะ", "ลูกเรือกำลังมาช่วยคุณตอนนี้ค่ะ"],
    zh: ["我感觉不舒服。", "机组人员正在赶来帮助您。"],
    es: ["No me siento bien.", "Un miembro de la tripulación viene a ayudarle ahora."],
    fr: ["Je ne me sens pas bien.", "Un membre de l'équipage vient vous aider maintenant."],
    it: ["Non mi sento bene.", "Un membro dell'equipaggio sta arrivando per aiutarti."],
    pt: ["Não me sinto bem.", "Um membro da tripulação está a vir ajudá-lo agora."],
    bn: ["আমার শরীর ভালো লাগছে না।", "একজন ক্রু সদস্য এখনই আপনাকে সাহায্য করতে আসছেন।"],
    te: ["నాకు ఆరోగ్యం బాగోలేదు.", "ఒక సిబ్బంది సభ్యుడు ఇప్పుడే మీకు సహాయం చేయడానికి వస్తున్నారు."],
    mr: ["मला बरे वाटत नाही.", "क्रू सदस्य आता तुम्हाला मदत करण्यासाठी येत आहे."],
    gu: ["મને સારું લાગતું નથી.", "ક્રૂ સભ્ય હમણાં જ તમારી મદદ માટે આવી રહ્યા છે."],
    kn: ["ನನಗೆ ಆರೋಗ್ಯ ಸರಿಯಿಲ್ಲ.", "ಒಬ್ಬ ಸಿಬ್ಬಂದಿ ಸದಸ್ಯರು ಈಗ ನಿಮಗೆ ಸಹಾಯ ಮಾಡಲು ಬರುತ್ತಿದ್ದಾರೆ."],
    ml: ["എനിക്ക് സുഖമില്ല.", "ഒരു ക്രൂ അംഗം ഇപ്പോൾ നിങ്ങളെ സഹായിക്കാൻ വരുന്നു."],
    pa: ["ਮੇਰੀ ਸਿਹਤ ਠੀਕ ਨਹੀਂ ਹੈ।", "ਇੱਕ ਕਰੂ ਮੈਂਬਰ ਹੁਣੇ ਤੁਹਾਡੀ ਮਦਦ ਲਈ ਆ ਰਿਹਾ ਹੈ।"],
  },
};

const ANNOUNCE_TEXT = {
  en: "Please fasten your seatbelt.", hi: "कृपया अपनी सीट बेल्ट बांधें।",
  ta: "தயவுசெய்து உங்கள் சீட் பெல்ட்டை கட்டவும்.", th: "กรุณารัดเข็มขัดนิรภัย",
  zh: "请系好安全带。", es: "Por favor, abróchese el cinturón de seguridad.", fr: "Veuillez attacher votre ceinture de sécurité.",
  it: "Si prega di allacciare la cintura di sicurezza.", pt: "Por favor, aperte o cinto de segurança.",
  bn: "অনুগ্রহ করে আপনার সিট বেল্ট বাঁধুন।", te: "దయచేసి మీ సీట్ బెల్ట్ కట్టుకోండి.", mr: "कृपया तुमचा सीट बेल्ट बांधा.",
  gu: "કૃપા કરી તમારો સીટ બેલ્ટ બાંધો.", kn: "ದಯವಿಟ್ಟು ನಿಮ್ಮ ಸೀಟ್ ಬೆಲ್ಟ್ ಕಟ್ಟಿಕೊಳ್ಳಿ.", ml: "ദയവായി നിങ്ങളുടെ സീറ്റ് ബെൽറ്റ് ധരിക്കുക.",
  pa: "ਕਿਰਪਾ ਕਰਕੇ ਆਪਣੀ ਸੀਟ ਬੈਲਟ ਬੰਨ੍ਹੋ।",
};

function copyFor(lang) { return COPY[lang] || COPY.en; }

// ---- the avatar -------------------------------------------------------------------------------

// The real SkyConnect character art (web/public/images/skyconnect-assistant.png) -- a transparent
// PNG, so no SVG/CSS recreation. `poses` lets a future state (e.g. a dedicated "listening" or
// "celebrating" pose) use its own image once one exists; anything not in `poses` just reuses
// `src`, so this works today with the single asset and needs no change when more arrive.
export const DEFAULT_AVATAR_SRC = "/images/skyconnect-assistant.png";

export function CrewAvatar({ state = "idle", size = 112, src = DEFAULT_AVATAR_SRC, poses = {} }) {
  const photo = poses[state] || src;
  return (
    <div className="crew-avatar" data-state={state} style={{ width: size, height: size }} aria-hidden="true">
      <span className="ca-ring" />
      <span className="ca-spinner" />
      <div className="ca-photo-wrap">
        <Image src={photo} alt="" fill sizes={`${size}px`} style={{ objectFit: "contain" }} priority unoptimized />
      </div>
      <span className="ca-mic-badge"><Icon id="mic" /></span>
      <span className="ca-spark ca-spark-a" /><span className="ca-spark ca-spark-b" />
    </div>
  );
}

// ---- small shared bits -------------------------------------------------------------------------

function Bubble({ children, enCaption, onReplay, replayLabel }) {
  return (
    <div className="ob-bubble">
      <p>{children}</p>
      {enCaption ? <p className="ob-caption-en">{enCaption}</p> : null}
      {onReplay ? <button className="ob-replay" onClick={onReplay}><Icon id="replay" />{replayLabel}</button> : null}
    </div>
  );
}

function Progress({ step, total }) {
  return (
    <div className="ob-progress" role="progressbar" aria-valuenow={step} aria-valuemin={0} aria-valuemax={total}>
      {Array.from({ length: total }, (_, i) => <i key={i} className={i === step ? "on" : i < step ? "done" : ""} />)}
    </div>
  );
}

// ---- the flow -----------------------------------------------------------------------------------

// 11 screens, matching the reference storyboard 1:1 (its 12th "screen" is the floating assistant
// below, a persistent widget rather than a step in this flow).
const STEPS = ["welcome", "language", "greeting", "features", "scenario", "conversation", "crewresponse", "visual", "announcement", "accessibility", "done"];
const DIM_BG = new Set(["language", "features", "scenario", "conversation", "crewresponse", "visual", "accessibility"]);

function BackButton({ onClick }) {
  return <button className="ob-back" onClick={onClick} aria-label="Back"><span style={{ transform: "scaleX(-1)", display: "inline-flex" }}><Icon id="arrow" /></span></button>;
}

export function Onboarding({ cfg, seat, lang, onSelectLanguage, accessibility, onSetAccessibility, onComplete }) {
  const [step, setStep] = useState(0);
  const [avatarState, setAvatarState] = useState("idle");
  const [activeFeature, setActiveFeature] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [translated, setTranslated] = useState(false);
  const [voiced, setVoiced] = useState(false);
  const timers = useRef([]);
  const c = copyFor(lang);
  const fallingBack = !VOICED_LANGS.includes(lang);
  const langName = cfg.languages.find((l) => l.code === lang)?.name || lang;

  useEffect(() => { canSpeak(lang).then((ok) => setVoiced(ok && !fallingBack)); }, [lang, fallingBack]);
  useEffect(() => onSpeakingChange((on) => setAvatarState((s) => (on ? "speaking" : s === "speaking" ? "idle" : s))), []);
  useEffect(() => () => { stopSpeaking(); timers.current.forEach(clearTimeout); }, []);

  function sayNow(text) { if (voiced && text) speak(text, lang); }
  function after(ms, fn) { const id = setTimeout(fn, ms); timers.current.push(id); return id; }
  function go(delta) { setStep((s) => Math.max(0, Math.min(STEPS.length - 1, s + delta))); }
  function finish() {
    setAvatarState("celebrating");
    try { localStorage.setItem(`auralink-onboarded-${seat}`, "1"); } catch { /* private mode */ }
    onComplete();
  }

  // speak each step's lead line once it's shown
  useEffect(() => {
    const id = STEPS[step];
    if (id === "welcome") sayNow(c.welcomeBody);
    else if (id === "greeting") sayNow(c.greeting(langName));
    else if (id === "visual") sayNow(c.visualSub);
    else if (id === "announcement") sayNow(ANNOUNCE_TEXT[lang] || ANNOUNCE_TEXT.en);
    else if (id === "accessibility") sayNow(c.accessSub);
    else if (id === "crewresponse" && scenario) sayNow((DEMO_REPLIES[scenario][lang] || DEMO_REPLIES[scenario].en)[1]);
    else if (id === "done") { sayNow(c.doneBody); setAvatarState("celebrating"); after(900, () => setAvatarState("idle")); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, lang]);

  // "conversation": passenger's line appears, a short translating beat, then Next unlocks
  useEffect(() => {
    if (STEPS[step] !== "conversation" || !scenario) return;
    setTranslated(false); sayNow((DEMO_REPLIES[scenario][lang] || DEMO_REPLIES[scenario].en)[0]);
    const t = after(1400, () => setTranslated(true));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, scenario]);

  const id = STEPS[step];
  const progressTotal = 9; // language .. accessibility
  const progressIndex = Math.max(0, Math.min(8, step - 1));
  const paxLine = scenario ? (DEMO_REPLIES[scenario][lang] || DEMO_REPLIES[scenario].en)[0] : "";
  const crewLine = scenario ? (DEMO_REPLIES[scenario][lang] || DEMO_REPLIES[scenario].en)[1] : "";

  return (
    <div className="ob-screen" role="dialog" aria-label="Auralink introduction">
      <ScreenBg dim={DIM_BG.has(id)} />
      <div className="ob-wrap">
        <div className="ob-top">
          {step > 0 && step < STEPS.length - 1 ? <BackButton onClick={() => go(-1)} /> : <span />}
          {step > 0 && step < STEPS.length - 1 ? <Progress step={progressIndex} total={progressTotal} /> : <span />}
          {step < STEPS.length - 1 ? <div className="ob-skip"><button onClick={finish}>{c.skip}</button></div> : null}
        </div>

        {id === "welcome" ? (
          <div className="ob-body" style={{ justifyContent: "flex-end", alignItems: "center", textAlign: "center" }}>
            <div className="ob-avatar-row" style={{ marginTop: "auto" }}>
              <CrewAvatar state={avatarState} size={190} />
            </div>
            <h1 style={{ font: "800 28px/1.25 var(--display)", margin: 0 }}>{c.welcomeTitle}</h1>
            <Bubble onReplay={() => sayNow(c.welcomeBody)} replayLabel={c.replay}>{c.welcomeBody}</Bubble>
            <div className="ob-actions" style={{ width: "100%" }}>
              <button className="primary" onClick={() => go(1)}>{c.getStarted}</button>
            </div>
          </div>
        ) : null}

        {id === "language" ? (
          <div className="ob-body">
            <div className="ob-avatar-row"><CrewAvatar state={avatarState} size={84} /></div>
            <h2 style={{ margin: 0 }}>{c.chooseLang}</h2>
            <p className="muted" style={{ margin: 0 }}>{c.chooseLangSub}</p>
            <div className="ob-lang-list">
              {cfg.languages.map((l) => (
                <button key={l.code} className={`panel ob-lang-row ${lang === l.code ? "active" : ""}`} lang={l.code}
                  onClick={() => onSelectLanguage(l.code)}>
                  <span className="ob-lang-chip" style={{ background: langChipColor(l.code) }}>{l.code.toUpperCase()}</span>
                  <span><b lang={l.code}>{l.name}</b>{l.english !== l.name ? <small lang="en">{l.english}</small> : null}</span>
                  {lang === l.code ? <span className="ob-lang-check"><Icon id="check" /></span> : null}
                </button>
              ))}
            </div>
            {fallingBack ? <p className="ob-fallback-note">This tutorial continues in English — full narration for this language isn't ready yet.</p> : null}
            <div className="ob-actions"><button className="primary" onClick={() => go(1)}>{c.next}</button></div>
          </div>
        ) : null}

        {id === "greeting" ? (
          <div className="ob-body" style={{ justifyContent: "center" }}>
            <div className="ob-side-row">
              <CrewAvatar state={avatarState} size={150} />
              <Bubble onReplay={() => sayNow(c.greeting(langName))} replayLabel={c.replay}>{c.greeting(langName)}</Bubble>
            </div>
            <div className="ob-actions"><button className="primary" onClick={() => go(1)}>{c.next}</button></div>
          </div>
        ) : null}

        {id === "features" ? (
          <div className="ob-body">
            <div className="ob-side-row" style={{ alignItems: "flex-start" }}>
              <CrewAvatar state={avatarState} size={74} />
              <Bubble>{c.featuresTitle}</Bubble>
            </div>
            <div className="ob-feature-grid">
              {c.features.map((f) => (
                <button key={f.id} className={`panel ob-feature ${activeFeature === f.id ? "active" : ""}`}
                  onClick={() => { setActiveFeature(f.id); sayNow(`${f.title}. ${f.desc}`); }}>
                  <span className="ob-feature-icon"><Icon id={f.icon} /></span><b>{f.title}</b><span>{f.desc}</span>
                </button>
              ))}
            </div>
            <div className="ob-actions"><button className="primary" onClick={() => go(1)}>{c.next}</button></div>
          </div>
        ) : null}

        {id === "scenario" ? (
          <div className="ob-body">
            <div className="ob-side-row" style={{ alignItems: "flex-start" }}>
              <CrewAvatar state={avatarState} size={88} />
              <Bubble>{c.scenarioTitle}</Bubble>
            </div>
            <p className="muted" style={{ margin: 0 }}>{c.scenarioSub}</p>
            <div className="ob-scenario-grid">
              {c.scenarios.map((s) => (
                <button key={s.id} className={`panel ob-scenario ${scenario === s.id ? "active" : ""}`} onClick={() => setScenario(s.id)}>
                  <span className="ob-feature-icon"><Icon id={s.icon} /></span><span>{s.label}</span>
                  {scenario === s.id ? <span className="ob-lang-check" style={{ marginLeft: "auto" }}><Icon id="check" /></span> : null}
                </button>
              ))}
            </div>
            <div className="ob-actions"><button className="primary" disabled={!scenario} onClick={() => go(1)}>{c.startSimulation}</button></div>
          </div>
        ) : null}

        {id === "conversation" && scenario ? (
          <div className="ob-body">
            <span className="ob-demo-tag"><Icon id="alert" />{c.demoTag}</span>
            <h2 style={{ margin: 0 }}>{c.simTitle}</h2>
            <div className="ob-convo">
              <div className="ob-msg pax">{paxLine}</div>
              <div className="ob-status-row">
                {translated ? <Icon id="check" /> : <span className="ob-status-dot" />}
                {translated ? c.translated : c.translating}
              </div>
            </div>
            <div className="ob-actions"><button className="primary" disabled={!translated} onClick={() => go(1)}>{c.next}</button></div>
          </div>
        ) : null}

        {id === "crewresponse" && scenario ? (
          <div className="ob-body" style={{ justifyContent: "center" }}>
            <h2 style={{ margin: 0 }}>{c.crewRespondTitle}</h2>
            <div className="ob-convo"><div className="ob-msg pax" style={{ opacity: 0.6, fontSize: 13 }}>{paxLine}</div>
              <motion.div className="ob-msg crew" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>{crewLine}</motion.div>
            </div>
            <div className="ob-side-row" style={{ justifyContent: "flex-end" }}><CrewAvatar state={avatarState} size={96} /></div>
            <div className="ob-actions"><button className="primary" onClick={() => go(1)}>{c.next}</button></div>
          </div>
        ) : null}

        {id === "visual" ? (
          <div className="ob-body">
            <div className="ob-side-row" style={{ alignItems: "flex-start" }}>
              <CrewAvatar state={avatarState} size={74} />
              <Bubble>{c.visualTitle}</Bubble>
            </div>
            <p className="muted" style={{ margin: 0 }}>{c.visualSub}</p>
            <div className="ob-visual-grid">
              {(cfg.intents || []).slice(0, 6).map((it) => (
                <button key={it.id} className="panel ob-visual-tile" onClick={() => sayNow(it.label[lang] || it.label.en)}>
                  <span className="ob-feature-icon"><Icon id={it.id} /></span><b>{it.label[lang] || it.label.en}</b>
                </button>
              ))}
            </div>
            <span className="ob-demo-tag"><Icon id="alert" />{c.demoTag}</span>
            <div className="ob-actions"><button className="primary" onClick={() => go(1)}>{c.next}</button></div>
          </div>
        ) : null}

        {id === "announcement" ? (
          <div className="ob-body" style={{ alignItems: "center", textAlign: "center" }}>
            <div className="ob-avatar-row"><CrewAvatar state={avatarState} size={68} /><h2 style={{ margin: 0 }}>{c.announceTitle}</h2></div>
            <p className="muted" style={{ margin: 0 }}>{c.announceSub}</p>
            <div className="panel" style={{ alignItems: "center" }}><Picto id="seatbelt" big /></div>
            <Bubble onReplay={() => sayNow(ANNOUNCE_TEXT[lang] || ANNOUNCE_TEXT.en)} replayLabel={c.replay}>
              {ANNOUNCE_TEXT[lang] || ANNOUNCE_TEXT.en}
            </Bubble>
            <div className="ob-actions" style={{ width: "100%" }}><button className="primary" onClick={() => go(1)}>{c.next}</button></div>
          </div>
        ) : null}

        {id === "accessibility" ? (
          <div className="ob-body">
            <div className="ob-side-row" style={{ alignItems: "flex-start" }}>
              <CrewAvatar state={avatarState} size={74} />
              <Bubble>{c.accessTitle}</Bubble>
            </div>
            <p className="muted" style={{ margin: 0 }}>{c.accessSub}</p>
            <div className="panel settings-sheet">
              <div className="settings-row"><span>{c.largeText}</span>
                <button className="toggle" role="switch" aria-pressed={accessibility.senior} aria-label={c.largeText}
                  onClick={() => onSetAccessibility({ senior: !accessibility.senior })} /></div>
              <div className="settings-row"><span>{c.simpleLang}</span>
                <button className="toggle" role="switch" aria-pressed={accessibility.pictures} aria-label={c.simpleLang}
                  onClick={() => onSetAccessibility({ pictures: !accessibility.pictures })} /></div>
              {voiced ? (
                <div className="settings-row"><span>{c.audioGuide}</span>
                  <button className="toggle" role="switch" aria-pressed={accessibility.readAloud} aria-label={c.audioGuide}
                    onClick={() => onSetAccessibility({ readAloud: !accessibility.readAloud })} /></div>
              ) : null}
            </div>
            <div className="ob-actions"><button className="primary" onClick={() => go(1)}>{c.next}</button></div>
          </div>
        ) : null}

        {id === "done" ? (
          <div className="ob-body" style={{ justifyContent: "flex-end", alignItems: "center", textAlign: "center" }}>
            <div className="ob-avatar-row" style={{ marginTop: "auto" }}>
              <CrewAvatar state={avatarState} size={190} />
            </div>
            <h1 style={{ font: "800 28px/1.25 var(--display)", margin: 0 }}>{c.doneTitle}</h1>
            <Bubble>{c.doneBody}</Bubble>
            <div className="ob-check">
              {c.checklist.map((x, k) => <div className="ob-check-row" key={k}><Icon id="check" />{x}</div>)}
            </div>
            <div className="ob-actions" style={{ width: "100%" }}><button className="primary" onClick={finish}>{c.startUsing}</button></div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---- post-onboarding re-entry point -------------------------------------------------------------

export function OnboardingFab({ seat, lang, onReplay, onAskHelp, onChangeLanguage, onAccessibility }) {
  const [open, setOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const c = copyFor(lang);

  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(`auralink-fab-hint-${seat}`) === "1"; } catch { /* private mode */ }
    if (seen) return;
    const t = setTimeout(() => setShowHint(true), 500);
    return () => clearTimeout(t);
  }, [seat]);

  function dismissHint() {
    setShowHint(false);
    try { localStorage.setItem(`auralink-fab-hint-${seat}`, "1"); } catch { /* private mode */ }
  }

  return (
    <>
      <AnimatePresence>
        {showHint && !open ? (
          <motion.div className="ob-fab-hint" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            onClick={dismissHint}>{c.needHelp}</motion.div>
        ) : null}
      </AnimatePresence>
      <button className="ob-fab" aria-label="Assistant" onClick={() => { setOpen((x) => !x); dismissHint(); }}>
        <CrewAvatar state="idle" size={40} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div className="ob-fab-menu panel" style={{ position: "fixed", right: 16, bottom: 82, zIndex: 40, width: 230 }}
            initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.96 }} transition={{ ease }}>
            <button onClick={() => { setOpen(false); onAskHelp(); }}><Icon id="chat" />{c.askHelp}</button>
            <button onClick={() => { setOpen(false); onReplay(); }}><Icon id="replay" />{c.replayTutorial}</button>
            <button onClick={() => { setOpen(false); onChangeLanguage(); }}><Icon id="globe" />{c.chooseLang}</button>
            <button onClick={() => { setOpen(false); onAccessibility(); }}><Icon id="settings" />{c.accessTitle}</button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
