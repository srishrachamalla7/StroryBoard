/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, Modality } from "@google/genai";

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable not set.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

// Types
interface Scene {
  scene: number;
  script: string;
  image_prompt: string;
  panel_text: string;
  // imageUrl can be a URL, null (loading), 'RETRYING', or 'FAILED'
  imageUrl?: string | null;
}

const dataURLtoBlob = (dataurl: string) => {
    const arr = dataurl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch) {
        throw new Error("Invalid data URL");
    }
    const mime = mimeMatch[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], {type:mime});
}

const formatVoiceName = (voice: SpeechSynthesisVoice): string => {
  let name = voice.name
    .replace('Microsoft', '')
    .replace('Google', '')
    .replace('Online', '')
    .replace('(Natural)', '')
    .replace('Multilingual', '')
    .trim();
    
  name = name.split('-')[0].split(' ')[0].trim();
  
  const langParts = voice.lang.split('-');
  const countryCode = langParts.length > 1 ? langParts[1].toUpperCase() : '';

  return countryCode ? `${name} (${countryCode})` : name;
};


const App = () => {
  const [storyIdea, setStoryIdea] = useState('');
  const [genre, setGenre] = useState('Sci-Fi');
  const [isLoading, setIsLoading] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isGenerated, setIsGenerated] = useState(false);
  const [isReviewingScript, setIsReviewingScript] = useState(false);
  const [isSlideshowOpen, setIsSlideshowOpen] = useState(false);
  const [isDevMode, setIsDevMode] = useState(true);
  const [editingScene, setEditingScene] = useState<Scene | null>(null);
  const [numPanels, setNumPanels] = useState(10);
  const [characterImageB64, setCharacterImageB64] = useState<string | null>(null);
  const [isRegeneratingImage, setIsRegeneratingImage] = useState(false);
  const [isRegeneratingScript, setIsRegeneratingScript] = useState(false);
  
  // State for TTS Voices
  const [allVoices, setAllVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [curatedVoices, setCuratedVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | null>(null);

  useEffect(() => {
    const loadVoices = () => {
        const availableVoices = window.speechSynthesis.getVoices();
        if (availableVoices.length > 0) {
            setAllVoices(availableVoices);
            const enVoices = availableVoices.filter(v => v.lang.startsWith('en')).sort((a, b) => a.name.localeCompare(b.name));
            const limitedVoices = enVoices.slice(0, 12);
            setCuratedVoices(limitedVoices);
            if (!selectedVoiceURI && limitedVoices.length > 0) {
                setSelectedVoiceURI(limitedVoices[0].voiceURI);
            }
        }
    };
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
  }, []);

  const handleGenerate = async () => {
    setIsGenerated(false);
    setScenes([]);
    setCharacterImageB64(null);
    setIsReviewingScript(true);
    setIsLoading(false); // No loading screen, go straight to streaming review
    setProgressMessage('Writing your comic book script...');
    await generateAndStreamScripts();
  };
  
  const generateAndStreamScripts = async () => {
      try {
        await generateScripts(storyIdea, genre, numPanels);
        setProgressMessage('Please review the generated script.');
      } catch (error) {
        console.error("An error occurred during script generation:", error);
        setProgressMessage(`Error: ${error.message}. Please try again.`);
      }
  }

  const handleRegenerateScripts = async () => {
      setIsRegeneratingScript(true);
      setScenes([]);
      setIsGenerated(false);
      await generateAndStreamScripts();
      setIsRegeneratingScript(false);
  }

  const handleStartImageGeneration = async () => {
    setIsReviewingScript(false);
    setIsLoading(true);

    try {
      if (isDevMode) {
        setProgressMessage('Generating placeholder images for Development Mode...');
        const finalScenes: Scene[] = scenes.map(scene => ({
          ...scene,
          imageUrl: `https://picsum.photos/seed/${scene.scene}${Math.random()}/1600/900`
        }));
        setScenes(finalScenes);
        await new Promise(res => setTimeout(res, 1000));
      } else {
        setProgressMessage('Designing your main character...');
        const charImgB64 = await generateCharacterImage(storyIdea, genre);
        setCharacterImageB64(charImgB64);
        
        setProgressMessage(`Generating ${numPanels} comic panels in parallel...`);
        
        const imageGenerationPromises = scenes.map(async (scene, index) => {
            try {
                const imageUrl = await generateSceneImage(scene, charImgB64, genre);
                setScenes(prev => prev.map((s, i) => i === index ? { ...s, imageUrl } : s));
            } catch (e1) {
                console.warn(`Panel ${index + 1} failed once. Retrying...`, e1);
                setScenes(prev => prev.map((s, i) => i === index ? {...s, imageUrl: 'RETRYING'} : s));
                try {
                    await new Promise(res => setTimeout(res, 500));
                    const imageUrl = await generateSceneImage(scene, charImgB64, genre);
                    setScenes(prev => prev.map((s, i) => i === index ? { ...s, imageUrl } : s));
                } catch (e2) {
                    console.error(`Panel ${index + 1} failed on second attempt.`, e2);
                    setScenes(prev => prev.map((s, i) => i === index ? {...s, imageUrl: 'FAILED'} : s));
                }
            }
        });
        
        await Promise.all(imageGenerationPromises);
      }
      setProgressMessage('Your comic is complete!');
      setIsGenerated(true);

    } catch (error) {
      console.error("An error occurred during generation:", error);
      setProgressMessage(`Error: ${error.message}. Please try again.`);
    } finally {
      setIsLoading(false);
    }
  };
  
  const generateScripts = async (idea: string, selectedGenre: string, panels: number): Promise<void> => {
    const prompt = `You are a professional comic book writer. Based on the story idea "${idea}" and genre "${selectedGenre}", write a cohesive ${panels}-panel comic book script.
      - There must be exactly ${panels} panels.
      - For each panel, provide:
        1. A concise visual description ('script') of the action and setting (30-40 words).
        2. The dialogue or narration text to be placed in speech bubbles or caption boxes ('panel_text'). Keep it brief.
        3. A detailed prompt for an image generation AI ('image_prompt') describing character actions, setting, mood, and composition for the panel.
      Return the result as a JSON array of objects.`;
      
    const responseStream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json", responseSchema: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { scene: { type: Type.INTEGER }, script: { type: Type.STRING }, image_prompt: { type: Type.STRING }, panel_text: { type: Type.STRING } }, required: ["scene", "script", "image_prompt", "panel_text"] } } },
    });
    
    let buffer = '';
    let lastParsedLength = 0;
    for await (const chunk of responseStream) {
        buffer += chunk.text;
        try {
            // Try to parse the buffer as a complete array
            const parsed = JSON.parse(buffer);
            if (Array.isArray(parsed)) {
                setScenes(parsed.map((s, i) => ({...s, scene: i+1, imageUrl: null})));
                lastParsedLength = parsed.length;
            }
        } catch(e) {
            // Not a complete JSON object yet, try to find complete objects
            // This is a simple way to find objects in a streaming array
            const potentialArray = buffer + (buffer.endsWith(',') ? ']' : ']');
             try {
                const parsed = JSON.parse(potentialArray);
                if (Array.isArray(parsed) && parsed.length > lastParsedLength) {
                    setScenes(parsed.map((s, i) => ({...s, scene: i+1, imageUrl: null})));
                    lastParsedLength = parsed.length;
                }
            } catch (e2) {
                // Continue accumulating
            }
        }
    }
  };

  const generateCharacterImage = async (idea: string, selectedGenre: string): Promise<string> => {
    const imageResponse = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: `Professional comic book style character design of the main character for a ${selectedGenre} comic based on this idea: "${idea}". Medium shot, simple background, cinematic character art.`,
        config: { numberOfImages: 1, aspectRatio: '16:9' }
    });
    return imageResponse.generatedImages[0].image.imageBytes;
  };
  
  const generateSceneImage = async (scene: Scene, charImgB64: string, selectedGenre: string): Promise<string> => {
      const prompt = `You are a direct-to-image AI comic artist. Your only function is to generate an image. **DO NOT reply with text, questions, or explanations.**
Your task is to re-draw the provided character into a new comic book panel based on the following details.

**Comic Style:** ${selectedGenre}, dynamic, cinematic.
**Scene Description:** ${scene.image_prompt}.
**Text to Include:** Integrate the following text into the panel in speech bubbles or narration boxes: "${scene.panel_text}"

**Strict Instructions:**
1.  **Output Image Only:** Your entire response must be the generated image. No text.
2.  **Maintain Character:** The character's appearance, clothing, and features must be an exact match to the provided reference image.
3.  **Complete Panel:** The final image must be a complete 16:9 comic book panel with artwork and the integrated text.

Generate the image now.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: [ { inlineData: { data: charImgB64, mimeType: 'image/png' } }, { text: prompt } ] },
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
      });
      
      const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
      if (!imagePart || !imagePart.inlineData) {
          console.error("Model response did not contain an image part:", JSON.stringify(response, null, 2));
          throw new Error(`Panel ${scene.scene} image generation failed. The model did not return a valid image part.`);
      }
      return `data:image/png;base64,${imagePart.inlineData.data}`;
  }

  const handleUpdateScene = (updatedScene: Scene) => {
    setScenes(currentScenes => currentScenes.map(s => s.scene === updatedScene.scene ? updatedScene : s));
  };

  const handleRegenerateSingleScript = async (sceneToRegen: Scene) => {
    const prompt = `You are a professional comic book writer. You are regenerating a single panel script for a ${genre} comic based on the story: "${storyIdea}".
The panel to regenerate is Panel ${sceneToRegen.scene}. The original script was: "${sceneToRegen.script}".
Please provide a new, improved version for this single panel.
Return the result as a single JSON object with keys "script", "image_prompt", and "panel_text".`;

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { script: { type: Type.STRING }, image_prompt: { type: Type.STRING }, panel_text: { type: Type.STRING } }, required: ["script", "image_prompt", "panel_text"] } },
    });
    
    const newScriptData = JSON.parse(response.text);

    setScenes(currentScenes => 
        currentScenes.map(s => 
            s.scene === sceneToRegen.scene 
            ? { ...s, ...newScriptData } 
            : s
        )
    );
    
    setEditingScene(prev => prev ? { ...prev, ...newScriptData } : null);
  };
  
  const handleRegenerateImage = async (sceneIndex: number) => {
    if (!characterImageB64 || isRegeneratingImage) return;

    setIsRegeneratingImage(true);
    const sceneToRegen = scenes[sceneIndex];
    setScenes(prev => prev.map((s, i) => i === sceneIndex ? {...s, imageUrl: null} : s));

    try {
        const imageUrl = await generateSceneImage(sceneToRegen, characterImageB64, genre);
        setScenes(prev => prev.map((s, i) => i === sceneIndex ? {...s, imageUrl} : s));
    } catch (e1) {
        console.warn(`Panel ${sceneIndex + 1} failed once. Retrying...`, e1);
        setScenes(prev => prev.map((s, i) => i === sceneIndex ? {...s, imageUrl: 'RETRYING'} : s));
        try {
            await new Promise(res => setTimeout(res, 500));
            const imageUrl = await generateSceneImage(sceneToRegen, characterImageB64, genre);
            setScenes(prev => prev.map((s, i) => i === sceneIndex ? {...s, imageUrl} : s));
        } catch (e2) {
            console.error(`Panel ${sceneIndex + 1} failed on second attempt.`, e2);
            setScenes(prev => prev.map((s, i) => i === sceneIndex ? {...s, imageUrl: 'FAILED'} : s));
        }
    } finally {
        setIsRegeneratingImage(false);
    }
  };

  const startOver = () => {
    setIsGenerated(false);
    setScenes([]);
    setStoryIdea('');
    setIsReviewingScript(false);
  };
  
  const handleDownloadAll = () => {
      scenes.forEach((scene, index) => {
          if(scene.imageUrl && !['RETRYING', 'FAILED'].includes(scene.imageUrl)) {
              const blob = dataURLtoBlob(scene.imageUrl);
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `panel-${index + 1}.png`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
          }
      });
  };

  const handlePreviewVoice = (voiceURI: string) => {
    const voice = allVoices.find(v => v.voiceURI === voiceURI);
    if (voice) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance("Hello! This is a preview of my voice.");
      utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
    }
  };

  return (
    <div className="container">
      <header className="header">
        <h1>Comic Book AI Generator</h1>
        <p>Turn your story ideas into a {numPanels}-panel comic with AI.</p>
      </header>
      
      {!isGenerated && !isLoading && !isReviewingScript && (
        <div className="story-form">
          <div className="form-group">
            <label htmlFor="story-idea">Your Story Idea</label>
            <textarea id="story-idea" value={storyIdea} onChange={(e) => setStoryIdea(e.target.value)} placeholder="e.g., A lone astronaut discovers a mysterious alien artifact on Mars."></textarea>
          </div>
          <div className="form-group">
            <label htmlFor="genre">Genre</label>
            <select id="genre" value={genre} onChange={(e) => setGenre(e.target.value)}>
              <option>Sci-Fi</option> <option>Fantasy</option> <option>Adventure</option> <option>Mystery</option> <option>Horror</option> <option>Comedy</option>
            </select>
          </div>
          <div className="form-group panel-slider">
            <label htmlFor="num-panels">Number of Panels: <strong>{numPanels}</strong></label>
            <div>
              <span>5</span>
              <input type="range" id="num-panels" min="5" max="10" value={numPanels} onChange={(e) => setNumPanels(parseInt(e.target.value, 10))} />
              <span>10</span>
            </div>
          </div>
          <div className="form-group dev-mode-toggle">
            <label htmlFor="dev-mode">Development Mode</label>
            <label className="switch"><input id="dev-mode" type="checkbox" checked={isDevMode} onChange={() => setIsDevMode(!isDevMode)} /><span className="slider round"></span></label>
            <span>(Uses placeholder images to save API quota)</span>
          </div>
          <button className="btn" onClick={handleGenerate} disabled={!storyIdea.trim()}>Generate Comic</button>
        </div>
      )}

      {isLoading && !isReviewingScript && <ComicBookDisplaySkeleton numPanels={numPanels} />}
      {isReviewingScript && <ScriptReview scenes={scenes} numPanels={numPanels} onApprove={handleStartImageGeneration} onRegenerate={handleRegenerateScripts} onEditScene={(scene) => setEditingScene(scene)} isRegenerating={isRegeneratingScript} />}
      {isGenerated && scenes.length > 0 && <ComicBookDisplay scenes={scenes} onRegenerateImage={handleRegenerateImage} isRegeneratingImage={isRegeneratingImage}/>}
      
      {isGenerated && !isLoading && (
        <div className="generation-options">
          <div className="form-group">
            <label>Narration Voice</label>
            <div className="voice-selection-list">
              {curatedVoices.length === 0 ? <p>Loading voices...</p> : curatedVoices.map((voice) => (
                  <div key={voice.voiceURI} className="voice-item">
                    <input type="radio" id={voice.voiceURI} name="voice" value={voice.voiceURI} checked={selectedVoiceURI === voice.voiceURI} onChange={(e) => setSelectedVoiceURI(e.target.value)} />
                    <label htmlFor={voice.voiceURI} className="voice-label">{formatVoiceName(voice)}</label>
                    <button className="voice-preview-btn" onClick={() => handlePreviewVoice(voice.voiceURI)} aria-label={`Preview voice ${voice.name}`} >
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                    </button>
                  </div>
              ))}
            </div>
          </div>
          <div className="final-controls">
              <button className="btn" onClick={() => setIsSlideshowOpen(true)}>Play Slideshow</button>
              <button className="btn btn-secondary" onClick={handleDownloadAll}>Download All Panels</button>
              <button className="btn btn-secondary" onClick={startOver}>Create Another Comic</button>
          </div>
        </div>
      )}
      
      {editingScene && <ScriptEditModal scene={editingScene} onClose={() => setEditingScene(null)} onSave={handleUpdateScene} onRegenerate={handleRegenerateSingleScript} />}
      <SlideshowModal isOpen={isSlideshowOpen} scenes={scenes} onClose={() => setIsSlideshowOpen(false)} selectedVoiceURI={selectedVoiceURI} allVoices={allVoices} />
    </div>
  );
};

const ComicBookDisplaySkeleton = ({ numPanels }) => (
    <div className="comic-book-display">
        <div className="main-panel-display skeleton skeleton-main-panel"></div>
        <div className="filmstrip">
            {Array.from({ length: numPanels }).map((_, index) => (
                <div key={index} className="scene-card">
                    <div className="scene-card-visuals skeleton skeleton-card"></div>
                    <p><b>Panel {index + 1}</b></p>
                </div>
            ))}
        </div>
    </div>
);


const ScriptReview = ({ scenes, numPanels, onApprove, onRegenerate, onEditScene, isRegenerating }) => (
    <div className="script-review-container">
        <h2>{scenes.length < numPanels ? "Writing Your Script..." : "Review Your Script"}</h2>
        <p className="review-instructions">
          {scenes.length < numPanels ? "Scripts will appear below as they are generated..." : "Click on any panel to edit its script or dialogue before generating images."}
        </p>
        <div className="script-list">
            {scenes.map(scene => <div key={scene.scene} className="script-item" onClick={() => onEditScene(scene)} role="button" tabIndex={0}><h3>Panel {scene.scene}</h3><p><strong>Visuals:</strong> {scene.script}</p><p><strong>Text:</strong> "{scene.panel_text}"</p></div>)}
            {Array.from({ length: numPanels - scenes.length }).map((_, i) => (
                <div key={`placeholder-${i}`} className="script-item placeholder">
                    <h3>Panel {scenes.length + i + 1}</h3>
                    <div className="placeholder-content">
                        <div className="spinner"></div>
                        <span>Generating...</span>
                    </div>
                </div>
            ))}
        </div>
        <div className="modal-actions">
            <button className="btn btn-secondary" onClick={onRegenerate} disabled={scenes.length < numPanels || isRegenerating}>
              Regenerate Full Script
              {isRegenerating && <span className="btn-spinner"></span>}
            </button>
            <button className="btn" onClick={onApprove} disabled={scenes.length < numPanels || isRegenerating}>Approve & Create Images</button>
        </div>
    </div>
);

const ScriptEditModal = ({ scene, onClose, onSave, onRegenerate }) => {
    const [editedScene, setEditedScene] = useState(scene);
    const [isRegenerating, setIsRegenerating] = useState(false);

    useEffect(() => { setEditedScene(scene); }, [scene]);
    const handleSave = () => { onSave(editedScene); onClose(); };
    const handleChange = (e) => setEditedScene(prev => ({...prev, [e.target.name]: e.target.value}));
    const handleRegenerate = async () => {
        setIsRegenerating(true);
        try { await onRegenerate(editedScene); }
        catch (error) { console.error("Single script regeneration failed:", error); alert(`Failed to regenerate script: ${error.message}`); }
        finally { setIsRegenerating(false); }
    }
    return <div className="modal-overlay" onClick={onClose}><div className="modal-content" onClick={e => e.stopPropagation()}><h2>Edit Panel {editedScene.scene}</h2><div className="form-group"><label htmlFor="panel_text">Panel Text (Dialogue/Narration)</label><textarea id="panel_text" name="panel_text" value={editedScene.panel_text} onChange={handleChange} disabled={isRegenerating}/></div><div className="form-group"><label htmlFor="script">Visual Description (for AI Artist)</label><textarea id="script" name="script" value={editedScene.script} onChange={handleChange} disabled={isRegenerating}/></div><div className="modal-actions"><button className="btn btn-secondary" onClick={handleRegenerate} disabled={isRegenerating}>Regenerate This Panel{isRegenerating && <span className="btn-spinner"></span>}</button><button className="btn" onClick={handleSave} disabled={isRegenerating}>Save Changes</button></div><button className="modal-close-btn" onClick={onClose}>&times;</button></div></div>;
};

const SlideshowModal = ({ isOpen, scenes, onClose, selectedVoiceURI, allVoices }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isCompleted, setIsCompleted] = useState(false);

    const goToPrevious = useCallback(() => {
        setCurrentIndex(prev => (prev > 0 ? prev - 1 : 0));
    }, []);

    const goToNext = useCallback(() => {
        setCurrentIndex(prev => {
            if (prev < scenes.length - 1) {
                return prev + 1;
            } else {
                setIsCompleted(true);
                return prev; // Stay on the last index
            }
        });
    }, [scenes.length]);

    const handleRestart = useCallback(() => {
        setIsCompleted(false);
        setCurrentIndex(0);
    }, []);

    useEffect(() => {
        if (isOpen) {
            window.speechSynthesis.cancel();
            const voice = allVoices.find(v => v.voiceURI === selectedVoiceURI);
            let utterance: SpeechSynthesisUtterance | undefined;

            if (isCompleted) {
                utterance = new SpeechSynthesisUtterance("The slideshow is completed. Do you want to restart?");
            } else if (scenes.length > 0) {
                const scene = scenes[currentIndex];
                if (scene && scene.panel_text) {
                    utterance = new SpeechSynthesisUtterance(scene.panel_text);
                }
            }

            if (utterance) {
                if (voice) {
                    utterance.voice = voice;
                }
                window.speechSynthesis.speak(utterance);
            }
        } else {
            window.speechSynthesis.cancel();
        }
    }, [isOpen, currentIndex, scenes, selectedVoiceURI, allVoices, isCompleted]);
    
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            onClose();
            return;
        }
        if (isCompleted) return;

        if (e.key === 'ArrowLeft') goToPrevious();
        else if (e.key === 'ArrowRight') goToNext();
      };
      if (isOpen) {
        setCurrentIndex(0);
        setIsCompleted(false);
        document.addEventListener('keydown', handleKeyDown);
      }
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        window.speechSynthesis.cancel();
      };
    }, [isOpen, isCompleted, onClose, goToPrevious, goToNext]);

    if (!isOpen) return null;

    const currentScene = scenes[currentIndex];
    
    return (
        <div className="slideshow-overlay" onClick={onClose}>
            <div className="slideshow-content" onClick={e => e.stopPropagation()}>
                <button className="slideshow-close" onClick={onClose} aria-label="Close slideshow">&times;</button>
                {isCompleted ? (
                    <div className="slideshow-completed">
                        <h2>Slideshow Completed</h2>
                        <p>Do you want to restart?</p>
                        <button className="btn" onClick={handleRestart}>Restart</button>
                    </div>
                ) : (
                    currentScene && <>
                        {currentScene.imageUrl === 'FAILED' ? (
                            <div className="panel-failure-placeholder main">Image generation failed for this panel.</div>
                        ) : (
                            currentScene.imageUrl ? <img src={currentScene.imageUrl} alt={`Panel ${currentScene.scene}`} className="slideshow-image"/> : <div className="panel-failure-placeholder main">Loading Image...</div>
                        )}
                        <button className="slideshow-nav prev" onClick={goToPrevious} aria-label="Previous panel" disabled={currentIndex === 0}>&#10094;</button>
                        <button className="slideshow-nav next" onClick={goToNext} aria-label="Next panel">&#10095;</button>
                        <div className="slideshow-caption"><p><strong>Panel {currentScene.scene}:</strong> {currentScene.panel_text || currentScene.script}</p></div>
                    </>
                )}
            </div>
        </div>
    );
}

const ComicBookDisplay = ({ scenes, onRegenerateImage, isRegeneratingImage }) => {
    const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
    const selectPanel = (index: number) => { if (scenes[index].imageUrl === 'RETRYING') return; setCurrentSceneIndex(index); }
    const currentScene = scenes[currentSceneIndex];
    const hasFailed = currentScene?.imageUrl === 'FAILED';
    const isReadyForRegen = currentScene?.imageUrl && !isRegeneratingImage && !['RETRYING', 'FAILED'].includes(currentScene.imageUrl);

    return (
        <div className="comic-book-display">
            <div className="main-panel-display">
                {isRegeneratingImage && scenes[currentSceneIndex]?.imageUrl === null ? (
                    <div className="main-panel-overlay" style={{opacity: 1}}><div className="spinner"></div></div>
                ) : hasFailed ? (
                    <div className="panel-failure-placeholder main">Image generation failed for this panel.</div>
                ) : (
                    currentScene?.imageUrl && <img src={currentScene.imageUrl} alt={`Comic panel for scene ${currentScene.scene}`} key={currentScene.imageUrl} />
                )}
                {isReadyForRegen && (
                    <div className="main-panel-overlay">
                        <button className="btn regenerate-image-btn" onClick={() => onRegenerateImage(currentSceneIndex)}>Regenerate Image</button>
                    </div>
                )}
            </div>
            <div className="filmstrip">
                {scenes.map((scene, index) => {
                    const isActive = index === currentSceneIndex;
                    const isClickable = scene.imageUrl !== 'RETRYING';
                    
                    return (
                        <div key={scene.scene} className={`scene-card ${isActive ? 'active' : ''} ${isClickable ? 'clickable' : ''}`} onClick={() => selectPanel(index)} role="button" tabIndex={0}>
                           <div className="scene-card-visuals">
                              {!scene.imageUrl && <div className="card-spinner"></div>}
                              {scene.imageUrl === 'RETRYING' && <span>Retrying...</span>}
                              {scene.imageUrl === 'FAILED' && <div className="panel-failure-placeholder">Generation Failed</div>}
                              {scene.imageUrl && !['RETRYING', 'FAILED'].includes(scene.imageUrl) && <img src={scene.imageUrl} alt={`Thumbnail for panel ${scene.scene}`} />}
                           </div>
                           <p><b>Panel {scene.scene}</b></p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);