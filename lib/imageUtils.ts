/**
 * Compresses an image file using Canvas and optionally adds a watermark.
 */
export const compressImage = (
    file: File, 
    quality = 0.6, 
    maxWidth = 1024, 
    watermarkData?: { 
        time: string; 
        date: string; 
        day: string; 
        location: string; 
        coords: string; 
        verifyCode: string; 
    }
): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = (maxWidth / width) * height;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error('Failed to get context'));

                ctx.drawImage(img, 0, 0, width, height);

                if (watermarkData) {
                    // --- WATERMARK LOGIC ---
                    const padding = width * 0.05;
                    const bottomY = height - padding;
                    
                    // Shadow for text readability
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
                    ctx.shadowBlur = 4;
                    ctx.shadowOffsetX = 1;
                    ctx.shadowOffsetY = 1;
                    
                    // 1. Time (Main) - Adjusted to be smaller (approx 0.06 of width)
                    const timeFontSize = Math.floor(width * 0.065);
                    ctx.font = `bold ${timeFontSize}px Inter, Roboto, Arial`;
                    ctx.fillStyle = 'white';
                    ctx.textAlign = 'left';
                    const timeWidth = ctx.measureText(watermarkData.time).width;
                    const mainRowY = bottomY - (width * 0.11); // Elevated to leave space for location/verify
                    ctx.fillText(watermarkData.time, padding, mainRowY);

                    // 2. Vertical Line
                    const lineX = padding + timeWidth + 10;
                    const lineY1 = mainRowY - (timeFontSize * 0.85);
                    const lineY2 = mainRowY + 2;
                    ctx.strokeStyle = '#facc15'; // Yellow-400
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(lineX, lineY1);
                    ctx.lineTo(lineX, lineY2);
                    ctx.stroke();

                    // 3. Date and Day (Stacked next to time)
                    const secondaryFontSize = Math.floor(width * 0.03);
                    ctx.font = `bold ${secondaryFontSize}px Inter, Roboto, Arial`;
                    ctx.fillText(watermarkData.date, lineX + 10, lineY1 + (secondaryFontSize * 0.9));
                    ctx.font = `normal ${secondaryFontSize}px Inter, Roboto, Arial`;
                    ctx.fillText(watermarkData.day, lineX + 10, lineY2);

                    // 4. Address and Coords (Below time row)
                    const infoFontSize = Math.floor(width * 0.028);
                    ctx.font = `bold ${infoFontSize}px Inter, Roboto, Arial`;
                    ctx.fillText(watermarkData.location, padding, mainRowY + (width * 0.045));
                    ctx.font = `normal ${infoFontSize}px Inter, Roboto, Arial`;
                    ctx.fillText(watermarkData.coords, padding, mainRowY + (width * 0.075));

                    // 5. Verification Code (Bottom)
                    const verifyFontSize = Math.floor(width * 0.024);
                    ctx.font = `bold ${verifyFontSize}px Inter, Roboto, Arial`;
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                    ctx.fillText(`🛡️ Código de Foto: ${watermarkData.verifyCode}`, padding, mainRowY + (width * 0.105));
                }

                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            const jpegBlob = blob.type === 'image/jpeg'
                                ? blob
                                : new Blob([blob], { type: 'image/jpeg' });
                            resolve(jpegBlob);
                        } else {
                            reject(new Error('Canvas toBlob failed'));
                        }
                    },
                    'image/jpeg',
                    quality
                );
            };
        };
        reader.onerror = (error) => reject(error);
    });
};
