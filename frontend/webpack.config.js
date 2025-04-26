const path = require('path');

module.exports = {
  mode: 'production', // Use 'development' for easier debugging
  entry: {
    'marees-france-card': './src/marees-france-card.js',
    'marees-france-card-editor': './src/marees-france-card-editor.js',
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, '../custom_components/marees_france/frontend'),
    clean: true, // Clean the output directory before each build
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
          },
        },
      },
    ],
  },
  // Optional: Add source maps for easier debugging in development
  // devtool: 'source-map',
};