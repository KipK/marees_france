const path = require('path');

module.exports = {
  mode: 'production', // Use 'development' for easier debugging
  entry: {
    'marees-france-card': './src/marees-france-card.ts', // Changed extension
    'marees-france-card-editor': './src/marees-france-card-editor.ts', // Changed extension
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, '../custom_components/marees_france/frontend'),
    clean: {
      keep: /__init__\.py$/, // Keep the __init__.py file
    },
  },
  // Define how modules are resolved
  resolve: {
    // Add '.ts' to resolved extensions
    extensions: ['.js', '.ts'],
  },
  optimization: {
    usedExports: true, // needed for tree shaking
  },
  module: {
    rules: [
      // Add rule for TypeScript files
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            // Override 'noEmit' from tsconfig.json specifically for ts-loader
            compilerOptions: {
              noEmit: false,
            },
          },
        },
      },
      // Existing rule for JavaScript files (ensure it doesn't process .ts)
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