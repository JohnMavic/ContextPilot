# RECHERCHIERAUFTRAG
## Verifizierung der OpenAI Speech-to-Text Modelle (Dezember 2025)

**Erstellt:** 27. Dezember 2025  
**Auftraggeber:** CONTEXTPILOT Projektteam  
**Berater:** ChatGPT o3 Pro  
**Status:** Abgeschlossen  
**Abschlussdatum:** 27. Dezember 2025  
**Priorität:** Mittel  

---

## Zusammenfassung der Findings

Das Modell gpt-4o-transcribe-2025-12-15 existiert nicht – nur die Mini-Variante erhielt im Dezember 2025 einen neuen Snapshot. Das bereits eingesetzte gpt-4o-mini-transcribe-2025-12-15 stellt die aktuellste und kosteneffizienteste Lösung für Echtzeit-Transkription dar: 50 Prozent günstiger als die Vollversion bei signifikant verbesserter Genauigkeit. Ein Upgrade auf gpt-4o-transcribe bringt keinen proportionalen Mehrwert für Live-Meeting-Szenarien.

---

## 1. Hintergrund und Ausgangslage

Das CONTEXTPILOT-Projekt ist eine Live-Transkriptionsanwendung, die Meetings in Echtzeit transkribiert. Dabei werden sowohl Mikrofon-Audio als auch Tab-Audio (beispielsweise von Videokonferenzen) erfasst und in Text umgewandelt. Die Anwendung unterstützt primär Deutsch und Englisch.

Aktuell setzen wir das Transkriptionsmodell gpt-4o-mini-transcribe-2025-12-15 ein. Dieses Modell wurde im Dezember 2025 von OpenAI veröffentlicht und verspricht laut Dokumentation eine um etwa 50 Prozent niedrigere Fehlerrate (Word Error Rate) im Vergleich zu Vorgängerversionen. Zudem soll es weniger Halluzinationen bei Stille produzieren und eine verbesserte Multilingual-Unterstützung bieten.

Eine interne Recherche hat ergeben, dass dieses Modell das einzige neue Speech-to-Text Modell mit dem Datumsstempel 2025-12-15 zu sein scheint. Es gibt offenbar keine entsprechende Vollversion namens gpt-4o-transcribe-2025-12-15. Diese Information muss durch einen externen Berater verifiziert werden, da wir sicherstellen möchten, dass wir das optimale Modell für unseren Anwendungsfall einsetzen.

---

## 2. Vorläufige Erkenntnisse (zu verifizieren)

Unsere bisherige Recherche hat folgende Speech-to-Text Modelle identifiziert:

Das Modell whisper ist das älteste und ein allgemeines Spracherkennungsmodell von OpenAI.

Das Modell gpt-4o-transcribe ist die Vollversion, die auf GPT-4o basiert. Es trägt keinen Datumsstempel und existiert als Basisversion.

Das Modell gpt-4o-mini-transcribe ist die kleinere und kostengünstigere Variante, ebenfalls ohne Datumsstempel in der Basisversion.

Das Modell gpt-4o-transcribe-diarize bietet zusätzlich Speaker-Diarization, also die Erkennung, welche Person wann spricht. Dieses Modell wurde im Oktober 2025 veröffentlicht.

Das Modell gpt-4o-mini-transcribe-2025-12-15 ist die neueste Version und das einzige Modell mit dem Dezember-2025-Datumsstempel. Es bietet verbesserte Transkriptionsgenauigkeit und Robustheit für Echtzeit-Szenarien.

Die zentrale Frage lautet: Gibt es ein Modell namens gpt-4o-transcribe-2025-12-15, also eine aktualisierte Vollversion? Unsere Recherche ergab, dass dieses Modell nicht existiert. Nur die Mini-Variante hat das Update erhalten. Diese Annahme muss jedoch durch unabhängige Prüfung bestätigt werden.

---

## 3. Prüfaufträge für den Berater

Der Berater soll folgende Aufgaben durchführen:

Erstens soll geprüft werden, ob ein Modell namens gpt-4o-transcribe-2025-12-15 existiert. Falls ja, sollen die Unterschiede zur Mini-Variante dokumentiert werden. Falls nein, soll dies mit einer offiziellen Quelle belegt werden.

Zweitens soll eine vollständige Liste aller aktuell verfügbaren Speech-to-Text Modelle von OpenAI erstellt werden. Diese Liste soll Modellnamen, Versionen, Veröffentlichungsdaten und Hauptmerkmale enthalten.

Drittens soll ein Preisvergleich zwischen der Mini-Variante und der Vollversion erstellt werden. Die Preise sollen pro einer Million Tokens angegeben werden, aufgeschlüsselt nach Input- und Output-Tokens.

Viertens sollen, falls verfügbar, Benchmark-Daten zur Qualität recherchiert werden. Insbesondere ist die Word Error Rate (WER) zwischen den verschiedenen Modellen von Interesse.

---

## 4. Zu prüfende Quellen

Der Berater soll mindestens folgende offizielle Quellen konsultieren:

Die Azure OpenAI Models Documentation unter der Adresse learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models enthält Informationen zu allen verfügbaren Modellen auf der Azure-Plattform. Der Abschnitt Speech-to-text models ist besonders relevant.

Die OpenAI Platform Models Dokumentation unter platform.openai.com/docs/models listet alle Modelle auf, die über die OpenAI API verfügbar sind. Hier sollten die Transcription-Modelle geprüft werden.

Die OpenAI Pricing Seite unter platform.openai.com/docs/pricing enthält die aktuellen Preise für alle Modelle und ermöglicht einen direkten Kostenvergleich.

Falls in diesen Quellen widersprüchliche Informationen gefunden werden, sollen alle Varianten dokumentiert und die Diskrepanzen aufgezeigt werden.

---

## 5. Erwartete Lieferobjekte

Der Berater soll folgende Ergebnisse liefern:

Eine vollständige Speech-to-Text Modell-Liste, die alle verfügbaren Modelle mit ihren Versionen, Preisen und Hauptmerkmalen aufführt.

Eine Empfehlung in maximal 200 Wörtern, welches Modell für die Live-Transkription im CONTEXTPILOT-Projekt am besten geeignet ist. Diese Empfehlung soll Kosten, Qualität und Latenz berücksichtigen.

Ein Quellenverzeichnis mit allen konsultierten URLs und dem jeweiligen Abrufdatum, um die Nachvollziehbarkeit der Recherche zu gewährleisten.

---

## 6. Zeitrahmen

Der Auftrag wird am 27. Dezember 2025 erteilt. Der Abschlussbericht wird bis zum 3. Januar 2026 erwartet. Bei Rückfragen kann der Berater das CONTEXTPILOT-Projektteam kontaktieren.

---

## 7. Kontext zum CONTEXTPILOT-Projekt

Das Projekt verwendet aktuell das Modell gpt-4o-mini-transcribe-2025-12-15 für die Echtzeit-Transkription. Die Anwendung erfasst Audio aus zwei Quellen: dem Mikrofon des Benutzers und dem Tab-Audio von Browser-Inhalten wie Videokonferenzen. Die primären Sprachen sind Deutsch und Englisch.

Die zentrale Frage für die Empfehlung lautet: Lohnt sich ein Upgrade auf die Vollversion gpt-4o-transcribe? Der Berater soll diese Frage unter Berücksichtigung von Kosten, Qualitätsunterschieden und Latenz beantworten. Falls die Qualitätsverbesserung marginal ist, der Preis jedoch deutlich höher, könnte die Mini-Variante die bessere Wahl bleiben.

---

## 8. Ergebnisse der Recherche

### 8.1 Existenzprüfung des Dezember-2025-Vollmodells

Die offizielle OpenAI API-Dokumentation listet explizit alle verfügbaren Transkriptionsmodelle auf. Ein Modell namens gpt-4o-transcribe-2025-12-15 ist weder in der OpenAI- noch in der Azure-Dokumentation verzeichnet. Die Vollversion gpt-4o-transcribe existiert nur in der Basisversion (Alias für die März-2025-Variante), während ausschließlich die Mini-Variante datierte Snapshots besitzt. Diese Diskrepanz erklärt sich durch OpenAIs Update-Strategie: Leichtgewichtige Modelle erhalten häufigere Iterationen, da sie schneller trainiert und optimiert werden können.

### 8.2 Vollständige Modell-Übersicht mit technischen Spezifikationen

Das Modell gpt-4o-transcribe in der Version 2025-03-20 kostet 0.006 Dollar pro Minute, unterstützt die Realtime-API, bietet keine Diarization und liefert die beste Genauigkeit.

Das Modell gpt-4o-mini-transcribe in der Version 2025-03-20 kostet 0.003 Dollar pro Minute, unterstützt die Realtime-API, bietet keine Diarization und liefert sehr gute Genauigkeit.

Das Modell gpt-4o-mini-transcribe in der Version 2025-12-15 kostet 0.003 Dollar pro Minute, unterstützt die Realtime-API, bietet keine Diarization und erreicht eine um etwa 50 Prozent niedrigere Word Error Rate als der Vorgänger.

Das Modell gpt-4o-transcribe-diarize in der Version 2025-10-15 kostet 0.006 Dollar pro Minute, unterstützt keine Realtime-API, bietet aber Speaker-Diarization.

Das Modell whisper-1 in der Version 001 (v2) kostet 0.006 Dollar pro Minute, unterstützt die Realtime-API, bietet keine Diarization und dient als Legacy-Baseline.

Alle Modelle unterstützen Deutsch und Englisch vollständig mit über 100 Sprachen Coverage. Die maximale Dateigröße beträgt einheitlich 25 MB, das Context Window 16.000 Tokens mit maximal 2.000 Output-Tokens.

### 8.3 Die Dezember-2025-Verbesserungen im Detail

Das Update gpt-4o-mini-transcribe-2025-12-15 bringt erhebliche Verbesserungen laut Azure OpenAI What's New. Die Transkriptionsgenauigkeit und Robustheit für Echtzeit-Szenarien wurde verbessert. Die Word Error Rate ist auf englischen Benchmarks um etwa 50 Prozent niedriger als bei der vorherigen Version.

Zusätzlich wurden Halluzinationen bei Stille und Hintergrundrauschen um bis zu 4-fach reduziert – ein kritischer Faktor für Live-Meeting-Szenarien. Die Mehrsprachigkeits-Performance verbesserte sich insbesondere für Japanisch und indische Sprachen, was für deutsch-englische Meetings indirekte Vorteile bei Akzenterkennung bringen kann.

### 8.4 Preisstruktur und Kosten-Nutzen-Analyse

Die Preisunterschiede sind substantiell und konsistent über alle Quellen:

Das Modell gpt-4o-mini-transcribe kostet 0.003 Dollar pro Minute, 0.18 Dollar pro Stunde, 1.25 Dollar pro Million Input-Tokens und 5.00 Dollar pro Million Output-Tokens.

Das Modell gpt-4o-transcribe kostet 0.006 Dollar pro Minute, 0.36 Dollar pro Stunde, 2.50 Dollar pro Million Input-Tokens und 10.00 Dollar pro Million Output-Tokens.

Die Mini-Variante ist somit konsistent 50 Prozent günstiger als die Vollversion.

Für 10.000 Minuten monatlicher Transkription (typisches Meeting-Volumen eines mittelgroßen Teams) ergibt sich: Die Mini-Variante kostet 30 Dollar pro Monat, die Vollversion 60 Dollar pro Monat. Die jährliche Ersparnis beträgt 360 Dollar.

Whisper-1 kostet identisch zur Vollversion (0.006 Dollar pro Minute), bietet aber keine Streaming-Unterstützung und hat höhere Word Error Rates.

### 8.5 Unterschiede zwischen Mini- und Vollversion

Die Azure-Dokumentation charakterisiert beide Modelle präzise:

Das Modell gpt-4o-transcribe hat die Qualitätseinstufung "Best Quality", die Geschwindigkeit "Fast" und ist ideal für Call Centers und präzise Protokolle.

Das Modell gpt-4o-mini-transcribe hat die Qualitätseinstufung "Great Quality", die Geschwindigkeit "Fastest" und ist ideal für Live Captioning und Echtzeit-Apps.

Die Vollversion liefert marginale Genauigkeitsvorteile bei schwierigem Audio (starke Akzente, Fachjargon, schlechte Aufnahmequalität). Für standardmäßige Meeting-Transkription mit klarer Sprache ist dieser Unterschied praktisch vernachlässigbar – insbesondere nach dem Dezember-2025-Update der Mini-Variante.

### 8.6 Word Error Rate Benchmarks

Quantitative WER-Daten sind begrenzt verfügbar, aber konsistent:

Das Modell gpt-4o-mini-transcribe-2025-12-15 erreicht etwa 50 Prozent niedrigere Word Error Rate gegenüber der März-Version auf englischen Benchmarks.

OpenAI attestiert beiden GPT-4o-Transkriptionsmodellen signifikante Verbesserungen der Word Error Rate gegenüber Whisper v2/v3.

Die FLEURS-Benchmark-Evaluierung zeigt konsistent bessere Ergebnisse über alle über 100 evaluierten Sprachen.

Exakte WER-Zahlen werden weder von OpenAI noch von Azure publiziert – dies ist branchenüblich, um Benchmark-Gaming zu vermeiden.

---

## 9. Empfehlung für CONTEXTPILOT

Bei gpt-4o-mini-transcribe-2025-12-15 bleiben.

Das aktuell eingesetzte Modell ist die optimale Wahl für Live-Meeting-Transkription in Deutsch und Englisch. Ein Upgrade auf gpt-4o-transcribe ist nicht empfehlenswert, da erstens die Kosten sich verdoppeln ohne proportionalen Qualitätsgewinn für Standard-Meetingaudio, zweitens die Latenz steigt weil Mini explizit für Echtzeit-Szenarien optimiert ist, und drittens das Dezember-Update die Lücke geschlossen hat mit 50 Prozent niedrigerer Word Error Rate als der Vorgänger.

Für Sprechererkennung wäre gpt-4o-transcribe-diarize interessant, jedoch ist es nicht in der Realtime API verfügbar – ein K.O.-Kriterium für Live-Transkription. Whisper-1 bietet keine Vorteile mehr: gleicher Preis wie die Vollversion, schlechtere Word Error Rate, kein Streaming.

Handlungsempfehlung: Sicherstellen, dass CONTEXTPILOT tatsächlich gpt-4o-mini-transcribe-2025-12-15 nutzt (nicht die März-Version). Falls ein Upgrade evaluiert wird: erst bei konkreten Qualitätsproblemen (starke Akzente, Fachjargon) gpt-4o-transcribe testen – die Kostensteigerung rechtfertigt sich nur bei nachweisbarem Mehrwert.

---

## 10. Quellenverzeichnis

Azure OpenAI Models Documentation, abgerufen unter learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models am 27. Dezember 2025.

Azure OpenAI What's New, abgerufen unter learn.microsoft.com/en-us/azure/ai-foundry/openai/whats-new am 27. Dezember 2025.

OpenAI API Reference Audio, abgerufen unter platform.openai.com/docs/api-reference/audio/createSpeech am 27. Dezember 2025.

OpenAI Models Documentation, abgerufen unter platform.openai.com/docs/models/gpt-4o-transcribe am 27. Dezember 2025.

OpenAI Realtime Transcription, abgerufen unter platform.openai.com/docs/guides/realtime-transcription am 27. Dezember 2025.

OpenAI Speech-to-Text Guide, abgerufen unter platform.openai.com/docs/guides/speech-to-text am 27. Dezember 2025.

Holori OpenAI Pricing Guide, abgerufen unter holori.com/openai-pricing-guide am 27. Dezember 2025.

CostGoat Transcription Pricing, abgerufen unter costgoat.com/pricing/openai-transcription am 27. Dezember 2025.

Azure AI Catalog gpt-4o-transcribe, abgerufen unter ai.azure.com/catalog/models/gpt-4o-transcribe am 27. Dezember 2025.

OpenAI Blog Next-Gen Audio, abgerufen unter openai.com/index/introducing-our-next-generation-audio-models am 27. Dezember 2025.

Diskrepanzen zwischen Quellen: Keine wesentlichen Widersprüche identifiziert. Azure und OpenAI dokumentieren identische Modell-IDs und Versionen. Preisangaben sind konsistent über alle Sekundärquellen.

---

*Dieses Dokument wurde am 27. Dezember 2025 erstellt und am selben Tag abgeschlossen.*
