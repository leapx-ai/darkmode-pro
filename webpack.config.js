const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');

// 检测是否为开发模式
const isDev = process.env.NODE_ENV !== 'production';

module.exports = {
  mode: isDev ? 'development' : 'production',
  
  // 入口配置
  entry: {
    'js/content': './src/js/content.js',
    'js/background': './src/js/background.js',
    'js/popup': './src/js/popup.js',
    'css/popup': './src/css/popup.css',
  },
  
  // 输出配置
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  
  // 模块处理
  module: {
    rules: [
      // CSS
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader',
        ],
      },
    ],
  },
  
  // 插件
  plugins: [
    // 提取 CSS
    new MiniCssExtractPlugin({
      filename: '[name].css',
    }),
    
    // 复制静态文件
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'src/manifest.json',
          to: 'manifest.json',
          transform(content) {
            // 根据环境修 manifest
            const manifest = JSON.parse(content.toString());
            if (isDev) {
              manifest.name += ' (Dev)';
            }
            return JSON.stringify(manifest, null, 2);
          },
        },
        {
          from: 'src/icons',
          to: 'icons',
          globOptions: {
            ignore: ['**/*.svg', '**/generate_*.py'],
          },
        },
        {
          from: 'src/html/popup.html',
          to: 'popup.html',
        },
        {
          from: 'public',
          to: 'public',
        },
        {
          from: 'docs',
          to: 'docs',
        },
        {
          from: 'README.md',
          to: 'README.md',
        },
        {
          from: 'LICENSE',
          to: 'LICENSE',
        },
      ],
    }),
    
    // 定义环境变量
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
    }),
  ],
  
  // 优化配置
  optimization: {
    minimize: !isDev,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: true,
            drop_debugger: true,
          },
          mangle: true,
          format: {
            comments: false,
          },
        },
        extractComments: false,
      }),
      new CssMinimizerPlugin(),
    ],
  },
  
  // 开发工具
  devtool: isDev ? 'cheap-module-source-map' : false,
  
  // 性能提示
  performance: {
    hints: isDev ? false : 'warning',
    maxEntrypointSize: 512000,
    maxAssetSize: 512000,
  },
  
  // 解析配置
  resolve: {
    extensions: ['.js', '.css'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  
  // 监听配置
  watchOptions: {
    ignored: /node_modules/,
    aggregateTimeout: 300,
  },
};
