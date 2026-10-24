"use client";
// First-run onboarding for the passenger seat screen: a short, skippable tour of what Auralink
// can do, hosted by a small illustrated crew-avatar character. Nothing here is a second product --
// language selection calls the real setLanguage() the rest of the app uses, accessibility toggles
// write the same fields showSettings() does, speech goes through lib/speech.js's existing offline
// voice (Kokoro, with the OS voice as its own fallback), and the feature tour uses the real intents
// from /api/config. The "scenario" and "visual" steps are clearly-labelled demos -- they never open
// a socket or create a real request, so trying the tutorial can never page the cabin crew.
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icons";
import { Picto } from "@/lib/pictograms";
import { canSpeak, isSpeaking, onSpeakingChange, speakNatural as speak, stopSpeaking } from "@/lib/speech";
import { ease } from "@/components/ui";

// Onboarding has its own narrative copy (not the per-screen UI strings in data/i18n) and its own
// offline voice in exactly the languages lib/speech.js already has a voice for. Any other
// passenger language falls back to the English copy with a visible note, same "never silently
// claim support that isn't there" rule the rest of the app follows.
export const VOICED_LANGS = ["en", "hi", "ta", "th"];

const COPY = {
  en: {
    welcomeTitle: "Welcome aboard!",
    welcomeBody: "I'm your personal Auralink assistant. I'll show you how to talk comfortably with your cabin crew, whatever language you speak.",
    getStarted: "Let's get started",
    skip: "Skip tutorial",
    chooseLang: "Choose your language",
    chooseLangSub: "You can change this any time from the seat screen.",
    greeting: (name) => `Hello! From now on I'll talk with you in ${name}.`,
    introTitle: "Meet your assistant",
    introBody: "I'm here for your whole flight. Tap me any time for help, a translation, or to ask the crew something.",
    featuresTitle: "What you can do",
    features: [
      { id: "talk", icon: "chat", title: "Talk to crew", desc: "Speak or type in your language — I translate it for the crew." },
      { id: "request", icon: "water", title: "Request services", desc: "Water, food, a blanket and more, one tap away." },
      { id: "announcements", icon: "bell", title: "Understand announcements", desc: "Crew announcements shown as text and pictures in your language." },
      { id: "medical", icon: "medical", title: "Medical & special help", desc: "Tell the crew exactly what you need, even under stress." },
      { id: "visual", icon: "grid", title: "Visual communication", desc: "Prefer not to speak? Tap pictures instead." },
      { id: "offline", icon: "wifi_off", title: "Works offline", desc: "Runs on this aircraft's own system — no internet needed." },
    ],
    scenarioTitle: "Let's try requesting something",
    scenarioSub: "Pick one to see how it works.",
    scenarios: [
      { id: "water", icon: "water", label: "Request water" },
      { id: "blanket", icon: "blanket", label: "Request a blanket" },
      { id: "medical", icon: "medical", label: "Ask for assistance" },
    ],
    demoTag: "Demo — nothing is sent to the crew",
    simTitle: "Here's how a real request looks",
    crewReplying: "Crew is replying…",
    sentNote: "Translated for the crew automatically",
    visualTitle: "Prefer pictures?",
    visualSub: "Tap any picture to ask for it — no typing or speaking needed.",
    announceTitle: "Understanding announcements",
    announceSub: "Crew announcements appear like this, in your language, with a picture.",
    accessTitle: "Make it comfortable for you",
    accessSub: "You can change these any time from the seat screen.",
    largeText: "Larger text", simpleLang: "Simple language & pictures", audioGuide: "Read things aloud",
    doneTitle: "You're all set!",
    doneBody: "You can now talk to your cabin crew comfortably. I'm here whenever you need help.",
    checklist: ["Language selected", "Features introduced", "Simulation completed", "Preferences set"],
    startUsing: "Start using Auralink",
    replay: "Replay", back: "Back", next: "Next", tryIt: "Try it",
    askHelp: "Ask for help", replayTutorial: "Replay tutorial",
  },
  hi: {
    welcomeTitle: "स्वागत है!",
    welcomeBody: "मैं आपका व्यक्तिगत Auralink सहायक हूँ। मैं आपको दिखाऊँगा कि आप अपनी भाषा में चालक दल से आराम से कैसे बात कर सकते हैं।",
    getStarted: "शुरू करें",
    skip: "ट्यूटोरियल छोड़ें",
    chooseLang: "अपनी भाषा चुनें",
    chooseLangSub: "आप इसे सीट स्क्रीन से कभी भी बदल सकते हैं।",
    greeting: (name) => `नमस्ते! अब से मैं आपसे ${name} में बात करूँगा।`,
    introTitle: "अपने सहायक से मिलें",
    introBody: "मैं पूरी उड़ान में आपके साथ हूँ। मदद, अनुवाद, या चालक दल से कुछ पूछने के लिए कभी भी मुझे टैप करें।",
    featuresTitle: "आप क्या कर सकते हैं",
    features: [
      { id: "talk", icon: "chat", title: "चालक दल से बात करें", desc: "अपनी भाषा में बोलें या टाइप करें — मैं इसे चालक दल के लिए अनुवाद करता हूँ।" },
      { id: "request", icon: "water", title: "सेवाओं का अनुरोध करें", desc: "पानी, भोजन, कंबल और अधिक, एक टैप में।" },
      { id: "announcements", icon: "bell", title: "घोषणाएँ समझें", desc: "चालक दल की घोषणाएँ आपकी भाषा में पाठ और चित्रों के रूप में।" },
      { id: "medical", icon: "medical", title: "चिकित्सा और विशेष सहायता", desc: "तनाव में भी चालक दल को बताएं कि आपको क्या चाहिए।" },
      { id: "visual", icon: "grid", title: "चित्रों से बात करें", desc: "बोलना नहीं चाहते? बस चित्रों पर टैप करें।" },
      { id: "offline", icon: "wifi_off", title: "बिना इंटरनेट के काम करता है", desc: "यह विमान के अपने सिस्टम पर चलता है — इंटरनेट की ज़रूरत नहीं।" },
    ],
    scenarioTitle: "कुछ अनुरोध करके देखें",
    scenarioSub: "देखने के लिए एक चुनें कि यह कैसे काम करता है।",
    scenarios: [
      { id: "water", icon: "water", label: "पानी माँगें" },
      { id: "blanket", icon: "blanket", label: "कंबल माँगें" },
      { id: "medical", icon: "medical", label: "सहायता माँगें" },
    ],
    demoTag: "डेमो — चालक दल को कुछ नहीं भेजा गया",
    simTitle: "एक असली अनुरोध ऐसा दिखता है",
    crewReplying: "चालक दल जवाब दे रहा है…",
    sentNote: "अपने आप चालक दल के लिए अनुवादित",
    visualTitle: "चित्र पसंद हैं?",
    visualSub: "अनुरोध करने के लिए किसी भी चित्र पर टैप करें — टाइप या बोलने की ज़रूरत नहीं।",
    announceTitle: "घोषणाएँ समझना",
    announceSub: "चालक दल की घोषणाएँ आपकी भाषा में, एक चित्र के साथ, ऐसी दिखती हैं।",
    accessTitle: "इसे अपने लिए आरामदायक बनाएं",
    accessSub: "आप इन्हें सीट स्क्रीन से कभी भी बदल सकते हैं।",
    largeText: "बड़ा टेक्स्ट", simpleLang: "सरल भाषा और चित्र", audioGuide: "ज़ोर से पढ़ें",
    doneTitle: "आप तैयार हैं!",
    doneBody: "अब आप अपने चालक दल से आराम से बात कर सकते हैं। जब भी मदद चाहिए, मैं यहाँ हूँ।",
    checklist: ["भाषा चुनी गई", "सुविधाएँ परिचित कराई गईं", "डेमो पूरा हुआ", "प्राथमिकताएँ सेट हुईं"],
    startUsing: "Auralink का उपयोग शुरू करें",
    replay: "फिर से सुनें", back: "वापस", next: "आगे", tryIt: "आज़माएँ",
    askHelp: "मदद माँगें", replayTutorial: "ट्यूटोरियल फिर से देखें",
  },
  ta: {
    welcomeTitle: "வரவேற்கிறோம்!",
    welcomeBody: "நான் உங்கள் தனிப்பட்ட Auralink உதவியாளர். நீங்கள் பேசும் மொழியில் பணியாளர்களுடன் எளிதாக பேசுவது எப்படி என்று காட்டுகிறேன்.",
    getStarted: "தொடங்குவோம்",
    skip: "பயிற்சியைத் தவிர்க்கவும்",
    chooseLang: "உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்",
    chooseLangSub: "இதை நீங்கள் எப்போது வேண்டுமானாலும் மாற்றலாம்.",
    greeting: (name) => `வணக்கம்! இனி நான் உங்களுடன் ${name} மொழியில் பேசுவேன்.`,
    introTitle: "உங்கள் உதவியாளரை சந்தியுங்கள்",
    introBody: "பயணம் முழுவதும் நான் இங்கே இருக்கிறேன். உதவி அல்லது மொழிபெயர்ப்புக்கு என்னைத் தட்டவும்.",
    featuresTitle: "நீங்கள் செய்யக்கூடியவை",
    features: [
      { id: "talk", icon: "chat", title: "பணியாளருடன் பேசுங்கள்", desc: "உங்கள் மொழியில் பேசுங்கள் அல்லது தட்டச்சு செய்யுங்கள் — நான் பணியாளருக்கு மொழிபெயர்க்கிறேன்." },
      { id: "request", icon: "water", title: "சேவைகளைக் கோருங்கள்", desc: "தண்ணீர், உணவு, போர்வை — ஒரு தட்டில்." },
      { id: "announcements", icon: "bell", title: "அறிவிப்புகளைப் புரிந்துகொள்ளுங்கள்", desc: "பணியாளர் அறிவிப்புகள் உங்கள் மொழியில் உரையாகவும் படமாகவும்." },
      { id: "medical", icon: "medical", title: "மருத்துவ உதவி", desc: "உங்களுக்கு என்ன தேவை என்பதை பணியாளரிடம் சொல்லுங்கள்." },
      { id: "visual", icon: "grid", title: "படங்கள் மூலம் தொடர்பு", desc: "பேச விரும்பவில்லையா? படங்களைத் தட்டவும்." },
      { id: "offline", icon: "wifi_off", title: "இணையமின்றி செயல்படும்", desc: "இந்த விமானத்தின் சொந்த அமைப்பில் இயங்குகிறது." },
    ],
    scenarioTitle: "ஒன்றைக் கோரிப் பார்ப்போம்",
    scenarioSub: "இது எப்படி வேலை செய்கிறது என்று பார்க்க ஒன்றைத் தேர்ந்தெடுக்கவும்.",
    scenarios: [
      { id: "water", icon: "water", label: "தண்ணீர் கேளுங்கள்" },
      { id: "blanket", icon: "blanket", label: "போர்வை கேளுங்கள்" },
      { id: "medical", icon: "medical", label: "உதவி கேளுங்கள்" },
    ],
    demoTag: "டெமோ — பணியாளருக்கு எதுவும் அனுப்பப்படவில்லை",
    simTitle: "ஒரு உண்மையான கோரிக்கை இப்படி இருக்கும்",
    crewReplying: "பணியாளர் பதிலளிக்கிறார்…",
    sentNote: "பணியாளருக்காக தானாக மொழிபெயர்க்கப்பட்டது",
    visualTitle: "படங்கள் பிடிக்குமா?",
    visualSub: "கோர எந்த படத்தையும் தட்டவும் — தட்டச்சு அல்லது பேச வேண்டாம்.",
    announceTitle: "அறிவிப்புகளைப் புரிந்துகொள்ளுதல்",
    announceSub: "பணியாளர் அறிவிப்புகள் உங்கள் மொழியில், ஒரு படத்துடன் இப்படி காட்டப்படும்.",
    accessTitle: "இதை உங்களுக்கு வசதியாக்குங்கள்",
    accessSub: "இவற்றை சீட் திரையிலிருந்து எப்போது வேண்டுமானாலும் மாற்றலாம்.",
    largeText: "பெரிய எழுத்து", simpleLang: "எளிய மொழி & படங்கள்", audioGuide: "சத்தமாகப் படிக்கவும்",
    doneTitle: "நீங்கள் தயார்!",
    doneBody: "இப்போது உங்கள் பணியாளருடன் எளிதாக பேசலாம். உதவி தேவைப்படும்போது நான் இங்கே இருக்கிறேன்.",
    checklist: ["மொழி தேர்ந்தெடுக்கப்பட்டது", "அம்சங்கள் அறிமுகம்", "டெமோ முடிந்தது", "விருப்பத்தேர்வுகள் அமைக்கப்பட்டன"],
    startUsing: "Auralink-ஐப் பயன்படுத்தத் தொடங்குங்கள்",
    replay: "மீண்டும் கேளுங்கள்", back: "பின்", next: "அடுத்து", tryIt: "முயற்சிக்கவும்",
    askHelp: "உதவி கேளுங்கள்", replayTutorial: "பயிற்சியை மீண்டும் காண்க",
  },
  th: {
    welcomeTitle: "ยินดีต้อนรับ!",
    welcomeBody: "ฉันคือผู้ช่วย Auralink ส่วนตัวของคุณ ฉันจะแสดงให้คุณเห็นวิธีพูดคุยกับลูกเรือได้อย่างสบายใจ ไม่ว่าคุณจะพูดภาษาอะไร",
    getStarted: "เริ่มกันเลย",
    skip: "ข้ามบทแนะนำ",
    chooseLang: "เลือกภาษาของคุณ",
    chooseLangSub: "คุณสามารถเปลี่ยนได้ทุกเมื่อจากหน้าจอที่นั่ง",
    greeting: (name) => `สวัสดีค่ะ! ต่อจากนี้ฉันจะพูดกับคุณเป็นภาษา${name}`,
    introTitle: "รู้จักผู้ช่วยของคุณ",
    introBody: "ฉันอยู่กับคุณตลอดเที่ยวบิน แตะที่ฉันได้ทุกเมื่อเพื่อขอความช่วยเหลือหรือแปลภาษา",
    featuresTitle: "สิ่งที่คุณทำได้",
    features: [
      { id: "talk", icon: "chat", title: "พูดคุยกับลูกเรือ", desc: "พูดหรือพิมพ์เป็นภาษาของคุณ — ฉันแปลให้ลูกเรือ" },
      { id: "request", icon: "water", title: "ขอบริการ", desc: "น้ำ อาหาร ผ้าห่ม และอื่น ๆ เพียงแตะเดียว" },
      { id: "announcements", icon: "bell", title: "เข้าใจประกาศ", desc: "ประกาศจากลูกเรือแสดงเป็นข้อความและภาพในภาษาของคุณ" },
      { id: "medical", icon: "medical", title: "ความช่วยเหลือทางการแพทย์", desc: "บอกลูกเรือว่าคุณต้องการอะไร แม้ในยามเครียด" },
      { id: "visual", icon: "grid", title: "สื่อสารด้วยภาพ", desc: "ไม่อยากพูด? แตะภาพแทนได้" },
      { id: "offline", icon: "wifi_off", title: "ทำงานได้โดยไม่ต้องใช้อินเทอร์เน็ต", desc: "ทำงานบนระบบของเครื่องบินลำนี้เอง" },
    ],
    scenarioTitle: "ลองขอสิ่งของดูสิ",
    scenarioSub: "เลือกสถานการณ์เพื่อดูว่ามันทำงานอย่างไร",
    scenarios: [
      { id: "water", icon: "water", label: "ขอน้ำ" },
      { id: "blanket", icon: "blanket", label: "ขอผ้าห่ม" },
      { id: "medical", icon: "medical", label: "ขอความช่วยเหลือ" },
    ],
    demoTag: "ตัวอย่าง — ไม่มีการส่งถึงลูกเรือจริง",
    simTitle: "คำขอจริงจะมีลักษณะแบบนี้",
    crewReplying: "ลูกเรือกำลังตอบกลับ…",
    sentNote: "แปลให้ลูกเรือโดยอัตโนมัติ",
    visualTitle: "ชอบใช้ภาพไหม?",
    visualSub: "แตะภาพใดก็ได้เพื่อขอสิ่งนั้น ไม่ต้องพิมพ์หรือพูด",
    announceTitle: "เข้าใจประกาศ",
    announceSub: "ประกาศจากลูกเรือจะแสดงแบบนี้ เป็นภาษาของคุณ พร้อมภาพประกอบ",
    accessTitle: "ปรับให้เหมาะกับคุณ",
    accessSub: "คุณสามารถเปลี่ยนได้ทุกเมื่อจากหน้าจอที่นั่ง",
    largeText: "ตัวอักษรใหญ่ขึ้น", simpleLang: "ภาษาง่าย & ภาพ", audioGuide: "อ่านออกเสียง",
    doneTitle: "พร้อมแล้ว!",
    doneBody: "ตอนนี้คุณสามารถพูดคุยกับลูกเรือได้อย่างสบายใจ ฉันอยู่ที่นี่เสมอเมื่อคุณต้องการความช่วยเหลือ",
    checklist: ["เลือกภาษาแล้ว", "แนะนำฟีเจอร์แล้ว", "ลองใช้งานตัวอย่างแล้ว", "ตั้งค่าความชอบแล้ว"],
    startUsing: "เริ่มใช้งาน Auralink",
    replay: "ฟังอีกครั้ง", back: "ย้อนกลับ", next: "ถัดไป", tryIt: "ลองดู",
    askHelp: "ขอความช่วยเหลือ", replayTutorial: "ดูบทแนะนำอีกครั้ง",
  },
};

const DEMO_REPLIES = {
  water: {
    en: ["I need water, please.", "Bringing it right away."],
    hi: ["मुझे पानी चाहिए।", "अभी लेकर आ रहे हैं।"],
    ta: ["எனக்கு தண்ணீர் வேண்டும்.", "இப்போதே கொண்டு வருகிறோம்."],
    th: ["ฉันต้องการน้ำค่ะ", "กำลังนำมาให้ทันทีค่ะ"],
  },
  blanket: {
    en: ["Could I have a blanket, please?", "Bringing it right away."],
    hi: ["क्या मुझे कंबल मिल सकता है?", "अभी लेकर आ रहे हैं।"],
    ta: ["எனக்கு ஒரு போர்வை கிடைக்குமா?", "இப்போதே கொண்டு வருகிறோம்."],
    th: ["ขอผ้าห่มได้ไหมคะ", "กำลังนำมาให้ทันทีค่ะ"],
  },
  medical: {
    en: ["I'm not feeling well.", "A crew member is coming to help you now."],
    hi: ["मेरी तबीयत ठीक नहीं है।", "चालक दल का सदस्य अभी आपकी मदद के लिए आ रहा है।"],
    ta: ["எனக்கு உடல்நிலை சரியில்லை.", "பணியாளர் இப்போதே உங்களுக்கு உதவ வருகிறார்."],
    th: ["ฉันรู้สึกไม่สบายค่ะ", "ลูกเรือกำลังมาช่วยคุณตอนนี้ค่ะ"],
  },
};

const ANNOUNCE_TEXT = {
  en: "Please fasten your seatbelt.", hi: "कृपया अपनी सीट बेल्ट बांधें।",
  ta: "தயவுசெய்து உங்கள் சீட் பெல்ட்டை கட்டவும்.", th: "กรุณารัดเข็มขัดนิรภัย",
};

function copyFor(lang) { return COPY[lang] || COPY.en; }

// ---- the avatar -------------------------------------------------------------------------------

export function CrewAvatar({ state = "idle", size = 112 }) {
  return (
    <div className="crew-avatar" data-state={state} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <g className="ca-spark"><path d="M14 26 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z" fill="var(--warn)" /><path d="M86 30 l1.6 4.2 4.2 1.6 -4.2 1.6 -1.6 4.2 -1.6 -4.2 -4.2 -1.6 4.2 -1.6z" fill="var(--ok)" /></g>
        <circle className="ca-ring" cx="50" cy="52" r="34" fill="none" stroke="var(--accent)" strokeWidth="2.5" />
        <circle className="ca-spinner" cx="50" cy="52" r="34" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray="42 170" strokeLinecap="round" />
        <g className="ca-head">
          <path d="M18 32 Q50 2 82 32 L80 40 Q50 18 20 40 Z" fill="var(--surface-3)" stroke="var(--line-strong)" strokeWidth="1" />
          <circle cx="50" cy="22" r="3.4" fill="var(--accent)" />
          <circle cx="50" cy="56" r="29" fill="#f0c6a0" />
          <path d="M22 50 a28 28 0 0 1 56 0" fill="none" />
          <ellipse className="ca-eye" cx="40" cy="52" rx="3.1" ry="4" fill="#2b2320" />
          <ellipse className="ca-eye" cx="60" cy="52" rx="3.1" ry="4" fill="#2b2320" />
          <path className="ca-mouth-idle" d="M39 67 Q50 75 61 67" stroke="#8a5338" strokeWidth="3" fill="none" strokeLinecap="round" />
          <ellipse className="ca-mouth-open" cx="50" cy="68" rx="8" ry="6" fill="#6b3a26" />
          <path d="M30 80 L50 92 L70 80 L70 100 L30 100 Z" fill="var(--surface-3)" />
          <path d="M44 80 L50 92 L56 80 Z" fill="var(--accent)" />
        </g>
        <g className="ca-mic-badge" transform="translate(76,76)">
          <circle r="11" fill="var(--accent)" />
          <rect x="-2.2" y="-6" width="4.4" height="8" rx="2.2" fill="#fff" />
          <path d="M-5 -1a5 5 0 0 0 10 0" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M0 3v3" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      </svg>
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

const STEPS = ["welcome", "language", "greeting", "intro", "features", "scenario", "simulation", "visual", "announcement", "accessibility", "done"];

export function Onboarding({ cfg, seat, lang, onSelectLanguage, accessibility, onSetAccessibility, onComplete }) {
  const [step, setStep] = useState(0);
  const [avatarState, setAvatarState] = useState("idle");
  const [activeFeature, setActiveFeature] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [simPhase, setSimPhase] = useState("pax");   // pax | thinking | crew
  const [voiced, setVoiced] = useState(false);
  const timers = useRef([]);
  const c = copyFor(lang);
  const fallingBack = !VOICED_LANGS.includes(lang);

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
    else if (id === "greeting") sayNow(c.greeting(cfg.languages.find((l) => l.code === lang)?.name || lang));
    else if (id === "intro") sayNow(c.introBody);
    else if (id === "visual") sayNow(c.visualSub);
    else if (id === "announcement") sayNow(ANNOUNCE_TEXT[lang] || ANNOUNCE_TEXT.en);
    else if (id === "accessibility") sayNow(c.accessSub);
    else if (id === "done") { sayNow(c.doneBody); setAvatarState("celebrating"); after(900, () => setAvatarState("idle")); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, lang]);

  useEffect(() => {
    if (STEPS[step] !== "simulation" || !scenario) return;
    setSimPhase("pax"); sayNow((DEMO_REPLIES[scenario][lang] || DEMO_REPLIES[scenario].en)[0]);
    const t1 = after(1400, () => setSimPhase("thinking"));
    const t2 = after(2600, () => { setSimPhase("crew"); sayNow((DEMO_REPLIES[scenario][lang] || DEMO_REPLIES[scenario].en)[1]); });
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, scenario]);

  const id = STEPS[step];
  const progressTotal = 9; // language .. accessibility
  const progressIndex = Math.max(0, Math.min(8, step - 1));

  return (
    <div className="ob-screen" role="dialog" aria-label="Auralink introduction">
      <div className="ob-wrap">
        <div className="ob-top">
          {step > 0 && step < STEPS.length - 1 ? <Progress step={progressIndex} total={progressTotal} /> : <span />}
          {step < STEPS.length - 1 ? <div className="ob-skip"><button onClick={finish}>{c.skip}</button></div> : null}
        </div>

        {id === "welcome" ? (
          <div className="ob-body" style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
            <div className="ob-avatar-row">
              <CrewAvatar state={avatarState} size={128} />
              <h1 style={{ font: "800 26px/1.25 var(--display)", margin: 0 }}>{c.welcomeTitle}</h1>
              <Bubble onReplay={() => sayNow(c.welcomeBody)} replayLabel={c.replay}>{c.welcomeBody}</Bubble>
            </div>
            <div className="ob-actions" style={{ width: "100%" }}>
              <button className="primary" onClick={() => go(1)}>{c.getStarted}</button>
            </div>
          </div>
        ) : null}

        {id === "language" ? (
          <div className="ob-body">
            <div className="ob-avatar-row"><CrewAvatar state={avatarState} size={72} /></div>
            <h2 style={{ margin: 0 }}>{c.chooseLang}</h2>
            <p className="muted" style={{ margin: 0 }}>{c.chooseLangSub}</p>
            <div className="choose-langs" style={{ margin: 0 }}>
              {cfg.languages.map((l) => (
                <button key={l.code} className={`choose-lang ${lang === l.code ? "active" : ""}`} lang={l.code}
                  onClick={() => onSelectLanguage(l.code)}>
                  <b>{l.name}</b>{l.english !== l.name ? <small lang="en">{l.english}</small> : null}
                </button>
              ))}
            </div>
            {fallingBack ? <p className="ob-fallback-note">This tutorial continues in English — full narration for this language isn't ready yet.</p> : null}
            <div className="ob-actions"><button className="primary" onClick={() => go(1)}>{c.next}</button></div>
          </div>
        ) : null}

        {id === "greeting" ? (
          <div className="ob-body" style={{ justifyContent: "center" }}>
            <div className="ob-avatar-row">
              <CrewAvatar state={avatarState} size={120} />
              <Bubble onReplay={() => sayNow(c.greeting(cfg.languages.find((l) => l.code === lang)?.name || lang))} replayLabel={c.replay}>
                {c.greeting(cfg.languages.find((l) => l.code === lang)?.name || lang)}
              </Bubble>
            </div>
            <div className="ob-actions"><button className="primary" onClick={() => go(1)}>{c.next}</button></div>
          </div>
        ) : null}

        {id === "intro" ? (
          <div className="ob-body" style={{ justifyContent: "center" }}>
            <div className="ob-avatar-row">
              <CrewAvatar state={avatarState} size={112} />
              <h2 style={{ margin: 0 }}>{c.introTitle}</h2>
              <Bubble onReplay={() => sayNow(c.introBody)} replayLabel={c.replay}>{c.introBody}</Bubble>
            </div>
            <div className="ob-actions"><button className="primary" onClick={() => go(1)}>{c.next}</button></div>
          </div>
        ) : null}

        {id === "features" ? (
          <div className="ob-body">
            <div className="row" style={{ gap: 10 }}><CrewAvatar state={avatarState} size={56} /><h2 style={{ margin: 0 }}>{c.featuresTitle}</h2></div>
            <div className="ob-feature-grid">
              {c.features.map((f) => (
                <button key={f.id} className={`panel ob-feature ${activeFeature === f.id ? "active" : ""}`}
                  onClick={() => { setActiveFeature(f.id); sayNow(`${f.title}. ${f.desc}`); }}>
                  <Icon id={f.icon} /><b>{f.title}</b><span>{f.desc}</span>
                </button>
              ))}
            </div>
            <div className="ob-actions"><button className="primary" onClick={() => go(1)}>{c.next}</button></div>
          </div>
        ) : null}

        {id === "scenario" ? (
          <div className="ob-body">
            <div className="ob-avatar-row"><CrewAvatar state={avatarState} size={72} />
              <h2 style={{ margin: 0 }}>{c.scenarioTitle}</h2>
              <p className="muted" style={{ margin: 0, textAlign: "center" }}>{c.scenarioSub}</p>
            </div>
            <div className="ob-scenario-grid">
              {c.scenarios.map((s) => (
                <button key={s.id} className="panel ob-scenario" onClick={() => { setScenario(s.id); go(1); }}>
                  <Icon id={s.icon} /><span>{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {id === "simulation" && scenario ? (
          <div className="ob-body">
            <span className="ob-demo-tag"><Icon id="alert" />{c.demoTag}</span>
            <h2 style={{ margin: 0 }}>{c.simTitle}</h2>
            <div className="ob-convo">
              <div className="ob-msg pax">{(DEMO_REPLIES[scenario][lang] || DEMO_REPLIES[scenario].en)[0]}
                <span className="ob-msg-sub">{c.sentNote}</span></div>
              {simPhase === "thinking" ? <span className="muted" style={{ fontSize: 13 }}>{c.crewReplying}</span> : null}
              {simPhase === "crew" ? (
                <motion.div className="ob-msg crew" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  {(DEMO_REPLIES[scenario][lang] || DEMO_REPLIES[scenario].en)[1]}
                </motion.div>
              ) : null}
            </div>
            <div className="ob-actions"><button className="primary" disabled={simPhase !== "crew"} onClick={() => go(1)}>{c.next}</button></div>
          </div>
        ) : null}

        {id === "visual" ? (
          <div className="ob-body">
            <div className="row" style={{ gap: 10 }}><CrewAvatar state={avatarState} size={56} /><h2 style={{ margin: 0 }}>{c.visualTitle}</h2></div>
            <p className="muted" style={{ margin: 0 }}>{c.visualSub}</p>
            <div className="ob-feature-grid">
              {(cfg.intents || []).slice(0, 6).map((it) => (
                <button key={it.id} className="panel ob-feature" style={{ alignItems: "center", textAlign: "center" }}
                  onClick={() => sayNow(it.label[lang] || it.label.en)}>
                  <Icon id={it.id} /><b>{it.label[lang] || it.label.en}</b>
                </button>
              ))}
            </div>
            <span className="ob-demo-tag"><Icon id="alert" />{c.demoTag}</span>
            <div className="ob-actions"><button className="primary" onClick={() => go(1)}>{c.next}</button></div>
          </div>
        ) : null}

        {id === "announcement" ? (
          <div className="ob-body" style={{ alignItems: "center", textAlign: "center" }}>
            <h2 style={{ margin: 0 }}>{c.announceTitle}</h2>
            <p className="muted" style={{ margin: 0 }}>{c.announceSub}</p>
            <Picto id="seatbelt" big />
            <Bubble onReplay={() => sayNow(ANNOUNCE_TEXT[lang] || ANNOUNCE_TEXT.en)} replayLabel={c.replay}>
              {ANNOUNCE_TEXT[lang] || ANNOUNCE_TEXT.en}
            </Bubble>
            <div className="ob-actions" style={{ width: "100%" }}><button className="primary" onClick={() => go(1)}>{c.next}</button></div>
          </div>
        ) : null}

        {id === "accessibility" ? (
          <div className="ob-body">
            <h2 style={{ margin: 0 }}>{c.accessTitle}</h2>
            <p className="muted" style={{ margin: 0 }}>{c.accessSub}</p>
            <div className="settings-sheet">
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
          <div className="ob-body" style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
            <div className="ob-avatar-row">
              <CrewAvatar state={avatarState} size={128} />
              <h1 style={{ font: "800 26px/1.25 var(--display)", margin: 0 }}>{c.doneTitle}</h1>
              <Bubble>{c.doneBody}</Bubble>
            </div>
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

export function OnboardingFab({ lang, onReplay, onAskHelp, onChangeLanguage, onAccessibility }) {
  const [open, setOpen] = useState(false);
  const c = copyFor(lang);
  return (
    <>
      <button className="ob-fab" aria-label="Assistant" onClick={() => setOpen((x) => !x)}>
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
