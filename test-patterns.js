const talib = require('technicalindicators');
console.log(Object.keys(talib).filter(k => k.toLowerCase().includes('pattern') || k.toLowerCase().includes('engulf') || k.toLowerCase().includes('doji') || k.toLowerCase().includes('morning') || k.toLowerCase().includes('evening') || k.toLowerCase().includes('hammer')));
