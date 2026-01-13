'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
    Box,
    Typography,
    Slider,
    TextField,
    Button,
    Paper,
    IconButton,
    Tooltip,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import RefreshIcon from '@mui/icons-material/Refresh';
import { isValidHexColor, hexToRgb, rgbToHsl, hslToRgb, rgbToHex } from '@/utils/colorUtils';

interface ThemeColorPickerProps {
    primaryColor: string;
    gradientDirection: number;
    colorIntensity: number;
    onColorChange: (color: string) => void;
    onGradientDirectionChange: (direction: number) => void;
    onColorIntensityChange: (intensity: number) => void;
    onReset?: () => void;
}

export default function ThemeColorPicker({
    primaryColor,
    gradientDirection,
    colorIntensity,
    onColorChange,
    onGradientDirectionChange,
    onColorIntensityChange,
    onReset,
}: ThemeColorPickerProps) {
    const theme = useTheme();
    const [hue, setHue] = useState(0);
    const [saturation, setSaturation] = useState(100);
    const [lightness, setLightness] = useState(50);
    const [hexInput, setHexInput] = useState(primaryColor);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDragging = useRef(false);

    // Convert hex to HSL on mount and when primaryColor changes
    useEffect(() => {
        if (isValidHexColor(primaryColor)) {
            const rgb = hexToRgb(primaryColor);
            if (rgb) {
                const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
                setHue(h);
                setSaturation(s);
                setLightness(l);
                setHexInput(primaryColor);
            }
        }
    }, [primaryColor]);

    // Draw color spectrum canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        // Draw saturation/lightness square
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const s = (x / width) * 100;
                const l = 100 - (y / height) * 100;
                const [r, g, b] = hslToRgb(hue, s, l);
                ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }, [hue]);

    // Handle canvas click/drag
    const handleCanvasInteraction = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

        const s = (x / rect.width) * 100;
        const l = 100 - (y / rect.height) * 100;

        setSaturation(s);
        setLightness(l);
        updateColorFromHSL(hue, s, l);
    }, [hue]);

    const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        isDragging.current = true;
        handleCanvasInteraction(e);
    };

    const handleCanvasMouseMove = useCallback((e: MouseEvent) => {
        if (isDragging.current) {
            handleCanvasInteraction(e);
        }
    }, [handleCanvasInteraction]);

    const handleCanvasMouseUp = useCallback(() => {
        isDragging.current = false;
    }, []);

    useEffect(() => {
        if (isDragging.current) {
            window.addEventListener('mousemove', handleCanvasMouseMove);
            window.addEventListener('mouseup', handleCanvasMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleCanvasMouseMove);
                window.removeEventListener('mouseup', handleCanvasMouseUp);
            };
        }
    }, [handleCanvasMouseMove, handleCanvasMouseUp]);

    const updateColorFromHSL = (h: number, s: number, l: number) => {
        const [r, g, b] = hslToRgb(h, s, l);
        const hex = rgbToHex(r, g, b);
        setHexInput(hex);
        onColorChange(hex);
    };

    const handleHueChange = (_: Event, value: number | number[]) => {
        const newHue = Array.isArray(value) ? value[0] : value;
        setHue(newHue);
        updateColorFromHSL(newHue, saturation, lightness);
    };

    const handleHexInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (value === '' || /^#[0-9A-Fa-f]{0,6}$/i.test(value)) {
            setHexInput(value);
            if (isValidHexColor(value)) {
                const rgb = hexToRgb(value);
                if (rgb) {
                    const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
                    setHue(h);
                    setSaturation(s);
                    setLightness(l);
                    onColorChange(value);
                }
            }
        }
    };

    const handleRandomColor = () => {
        const randomHue = Math.floor(Math.random() * 360);
        const randomSaturation = 60 + Math.random() * 40; // 60-100%
        const randomLightness = 40 + Math.random() * 20; // 40-60%
        setHue(randomHue);
        setSaturation(randomSaturation);
        setLightness(randomLightness);
        updateColorFromHSL(randomHue, randomSaturation, randomLightness);
    };

    const currentColor = isValidHexColor(hexInput) ? hexInput : '#22c55e';
    const [r, g, b] = hslToRgb(hue, saturation, lightness);
    const canvasColor = rgbToHex(r, g, b);

    return (
        <Paper
            sx={{
                p: 3,
                background: 'var(--surface-bg)',
                border: '1px solid var(--surface-border)',
                borderRadius: 2,
            }}
        >
            <Typography variant="h6" sx={{ mb: 2, color: 'var(--app-text)' }}>
                Theme Color Customization
            </Typography>

            {/* Color Spectrum Canvas */}
            <Box sx={{ mb: 2 }}>
                <Typography variant="body2" sx={{ color: 'var(--text-muted)', mb: 1 }}>
                    Select Color
                </Typography>
                <Box
                    sx={{
                        position: 'relative',
                        borderRadius: 2,
                        overflow: 'hidden',
                        border: '1px solid var(--surface-border)',
                        cursor: 'crosshair',
                    }}
                >
                    <canvas
                        ref={canvasRef}
                        width={300}
                        height={200}
                        onMouseDown={handleCanvasMouseDown}
                        style={{
                            display: 'block',
                            width: '100%',
                            height: 'auto',
                        }}
                    />
                    {/* Selection indicator */}
                    <Box
                        sx={{
                            position: 'absolute',
                            left: `${(saturation / 100) * 100}%`,
                            top: `${((100 - lightness) / 100) * 100}%`,
                            transform: 'translate(-50%, -50%)',
                            width: 16,
                            height: 16,
                            border: '2px solid white',
                            borderRadius: '50%',
                            boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
                            pointerEvents: 'none',
                        }}
                    />
                </Box>
            </Box>

            {/* Hue Slider */}
            <Box sx={{ mb: 2 }}>
                <Typography variant="body2" sx={{ color: 'var(--text-muted)', mb: 1 }}>
                    Hue
                </Typography>
                <Box
                    sx={{
                        position: 'relative',
                        height: 20,
                        borderRadius: 10,
                        background: `linear-gradient(to right, 
              hsl(0, 100%, 50%), 
              hsl(60, 100%, 50%), 
              hsl(120, 100%, 50%), 
              hsl(180, 100%, 50%), 
              hsl(240, 100%, 50%), 
              hsl(300, 100%, 50%), 
              hsl(360, 100%, 50%))`,
                        mb: 1,
                    }}
                />
                <Slider
                    value={hue}
                    min={0}
                    max={360}
                    onChange={handleHueChange}
                    sx={{
                        '& .MuiSlider-thumb': {
                            width: 20,
                            height: 20,
                            border: '2px solid white',
                            boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
                        },
                    }}
                />
            </Box>

            {/* Hex Input */}
            <Box sx={{ mb: 2 }}>
                <TextField
                    fullWidth
                    size="small"
                    label="Hex Color"
                    value={hexInput}
                    onChange={handleHexInputChange}
                    error={!isValidHexColor(hexInput) && hexInput !== ''}
                    helperText={
                        !isValidHexColor(hexInput) && hexInput !== ''
                            ? 'Invalid hex color'
                            : 'Enter hex color code (e.g., #22c55e)'
                    }
                    InputProps={{
                        startAdornment: isValidHexColor(hexInput) ? (
                            <Box
                                sx={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: 1,
                                    backgroundColor: hexInput,
                                    border: '1px solid var(--surface-border)',
                                    mr: 1,
                                }}
                            />
                        ) : null,
                    }}
                    sx={{
                        '& .MuiOutlinedInput-root': {
                            color: 'var(--app-text)',
                            '& fieldset': { borderColor: 'var(--surface-border)' },
                        },
                        '& .MuiInputLabel-root': { color: 'var(--text-muted)' },
                        '& .MuiFormHelperText-root': { color: 'var(--text-muted)' },
                    }}
                />
            </Box>

            {/* Gradient Direction Slider */}
            <Box sx={{ mb: 2 }}>
                <Typography variant="body2" sx={{ color: 'var(--text-muted)', mb: 1 }}>
                    Gradient Direction: {gradientDirection}°
                </Typography>
                <Slider
                    value={gradientDirection}
                    min={0}
                    max={360}
                    onChange={(_, value) => onGradientDirectionChange(Array.isArray(value) ? value[0] : value)}
                    sx={{
                        '& .MuiSlider-thumb': {
                            width: 20,
                            height: 20,
                        },
                    }}
                />
                <Box
                    sx={{
                        mt: 1,
                        height: 40,
                        borderRadius: 1,
                        background: `linear-gradient(${gradientDirection}deg, ${currentColor} 0%, ${canvasColor} 100%)`,
                        border: '1px solid var(--surface-border)',
                    }}
                />
            </Box>

            {/* Color Intensity Slider */}
            <Box sx={{ mb: 2 }}>
                <Typography variant="body2" sx={{ color: 'var(--text-muted)', mb: 1 }}>
                    Color Intensity: {colorIntensity}%
                </Typography>
                <Slider
                    value={colorIntensity}
                    min={0}
                    max={100}
                    onChange={(_, value) => onColorIntensityChange(Array.isArray(value) ? value[0] : value)}
                    sx={{
                        '& .MuiSlider-thumb': {
                            width: 20,
                            height: 20,
                        },
                    }}
                />
            </Box>

            {/* Action Buttons */}
            <Box display="flex" gap={1}>
                <Tooltip title="Random Color">
                    <IconButton
                        onClick={handleRandomColor}
                        sx={{
                            border: '1px solid var(--surface-border)',
                            color: 'var(--app-text)',
                        }}
                    >
                        <ShuffleIcon />
                    </IconButton>
                </Tooltip>
                {onReset && (
                    <Tooltip title="Reset to Defaults">
                        <IconButton
                            onClick={onReset}
                            sx={{
                                border: '1px solid var(--surface-border)',
                                color: 'var(--app-text)',
                            }}
                        >
                            <RefreshIcon />
                        </IconButton>
                    </Tooltip>
                )}
            </Box>
        </Paper>
    );
}
