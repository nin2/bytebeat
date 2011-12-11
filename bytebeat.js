function showAudioVisual(sound, player, viz) {
    player.src = makeAudioURI(sound);
    visualize(viz, sound, player);
}


function compileComposer(text) {
    return eval("(function(t) { return "
                + text.replace(/sin|cos|tan|floor|ceil/g,
                               function(str) { return "Math."+str; })
                + "})");
}


// Sound generation into WAV format
// See https://ccrma.stanford.edu/courses/422/projects/WaveFormat/

function makeSound(composers, duration, rate, bytesPerSample) {
    if (bytesPerSample !== 1)
        throw "I only do 8-bit audio yet";

    var nsamples = duration * rate;
    var nchannels = composers.length;
    var dataLength = nsamples * nchannels * bytesPerSample;

    var metadataLength = 12 + 24 + 8;
    var bytes = [].concat(
        // Header (length 12)
        cc("RIFF"), 
        bytesFromU32(metadataLength + dataLength),
        cc("WAVE"),
        // "fmt " subchunk (length 24):
        cc("fmt "),
        bytesFromU32(16), // length of this subchunk's data
        bytesFromU16(1),  // AudioFormat = 1 for PCM
        bytesFromU16(nchannels),
        bytesFromU32(rate),
        bytesFromU32(rate * nchannels * bytesPerSample),
        bytesFromU16(nchannels * bytesPerSample),
        bytesFromU16(8 * bytesPerSample),
        // "data" subchunk (length 8 + length(following samples)):
        cc("data"),
        bytesFromU32(dataLength)
    );
    if (bytes.length !== metadataLength)
        throw "Assertion failure";
    if (nchannels === 1) {
        var composer = composers[0];
        for (var t = 0; t < nsamples; ++t)
            bytes.push(0xFF & composer(t));
    } else if (nchannels === 2) {
        var composer0 = composers[0];
        var composer1 = composers[1];
        for (var t = 0; t < nsamples; ++t) {
            bytes.push(0xFF & composer0(t));
            bytes.push(0xFF & composer1(t));
        }
    } else
        throw "I only do 1- or 2-channel audio";
    if (bytes.length !== metadataLength + dataLength)
        throw "Assertion failure";

    return {
        duration: duration,
        rate: rate,
        nchannels: nchannels,
        bytesPerSample: bytesPerSample,
        bytes: bytes,
        channel0_8bit: function(t) { 
            return bytes[metadataLength + t * nchannels]; 
        },
        channel1_8bit: (nchannels < 2
                        ? function(t) { return 0; }
                        : function(t) { 
                            return bytes[metadataLength + t * nchannels + 1];
                        }),
    };
}

// String to array of byte values.
function cc(str) {
    var result = [];
    for (var i = 0; i < str.length; ++i)
        result.push(str.charCodeAt(i)); // XXX check that it's a byte
    return result;
}

function bytesFromU16(v) {
    return [0xFF & v, 0xFF & (v>>8)];
}
function bytesFromU32(v) {
    return [0xFF & v, 0xFF & (v>>8), 0xFF & (v>>16), 0xFF & (v>>24)];
}


// URI encoding

function makeAudioURI(sound) {
    return "data:audio/x-wav," + hexEncodeURI(sound.bytes);
}

var hexCodes = (function () {
    var result = [];
    for (var b = 0; b < 256; ++b)
        result.push((b < 16 ? "%0" : "%") + b.toString(16));
    return result;
})();
    
// [255, 0] -> "%ff%00"
function hexEncodeURI(values) {
    var codes = [];
    for (var i = 0; i < values.length; ++i)
        codes.push(hexCodes[values[i]]);
    return codes.join('');
}


// Visualization

var prev_t = null;

function visualize(canvas, sound, audio) {
    // A dot for each sample (green/blue for channel 0/1).
    canvasUpdate(canvas, function(pixbuf, width, height) {
        var p = 0;
        for (var y = 0; y < height; ++y) {
            for (var x = 0; x < width; ++x) {
                var t = height * x + y;
                pixbuf[p++] = 0;
                pixbuf[p++] = sound.channel0_8bit(t);
                pixbuf[p++] = sound.channel1_8bit(t);
                pixbuf[p++] = 0xFF;
            }
        }
    });
    if (audio)
        vizStart(function() { updateViz(canvas, audio, sound); },
                 33.33);
    prev_t = null;
}

var vizIntervalId;

function vizStop() {
    if (vizIntervalId) clearInterval(vizIntervalId);
    vizIntervalId = 0;
}

function vizStart(drawNextFrame, msecPerFrame) {
    vizStop();
    vizIntervalId = setInterval(drawNextFrame, msecPerFrame);
}

function updateViz(canvas, audio, sound) {
    var T = sound.duration * sound.rate;
    canvasUpdate(canvas, function(pixbuf, width, height) {
        if (prev_t !== null)
            flip(prev_t);
        if (sound.duration <= audio.currentTime)
            vizStop();
        else {
            var t = Math.round(audio.currentTime * sound.rate);
            flip(t); prev_t = t;
        }

        function flip(t) {
            wave(t);
            progress(t);
        }

        // A red waveform for the next 'width' samples.
        function wave(t) {
            var prevSample = sound.channel0_8bit(t);
            var after = Math.max(0, Math.min(T-t, width));
            for (var x = 0; x < after; ++x) {
                // XXX just channel 0 for now
                var sample = (height / 256) * sound.channel0_8bit(t + x);
                var lo = Math.min(prevSample, sample);
                var hi = Math.max(prevSample, sample);
                for (var y = height-1 - hi; y <= height-1 - lo; ++y) {
                    var p = 4 * (width * y + x);
                    pixbuf[p] ^= 0xFF;
                }
                prevSample = sample;
            }
        }

        // A progress bar as a vertical line of translucency.
        function progress(t) {
            var x = Math.floor(t / height);
            if (x < width) {
                for (y = 0; y < height; ++y) {
                    p = 4 * (width * y + x);
                    pixbuf[p+3] ^= 0xC0;
                }
            }
        }
    });
}

function canvasUpdate(canvas, f) {
    var ctx = canvas.getContext("2d");
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    f(imageData.data, canvas.width, canvas.height);
    ctx.putImageData(imageData, 0, 0);
}
