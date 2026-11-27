/* ==========================================================================
   Reliability Workbench — pure calculation core
   All functions are deterministic and side-effect free.
   ========================================================================== */
(function (global) {
  'use strict';

  var MAX_UNITS = 20;

  /* -------------------------------------------------------------------------
     RBD basics
     ------------------------------------------------------------------------- */

  /**
   * 串联系统：R_sys = ∏ R_i
   */
  function seriesReliability(rs) {
    return rs.reduce(function (acc, r) {
      return acc * r;
    }, 1);
  }

  /**
   * 并联系统：R_sys = 1 - ∏(1 - R_i)
   */
  function parallelReliability(rs) {
    return 1 - rs.reduce(function (acc, r) {
      return acc * (1 - r);
    }, 1);
  }

  /**
   * 二项系数 C(n, k)
   */
  function binomialCoefficient(n, k) {
    if (k < 0 || k > n) return 0;
    var kk = Math.min(k, n - k);
    var result = 1;
    for (var i = 1; i <= kk; i += 1) {
      result = (result * (n - kk + i)) / i;
    }
    return result;
  }

  /**
   * k/n 表决系统：
   * R_sys = Σ(i=k..n) C(n,i) · R^i · (1-R)^(n-i)
   */
  function kOutOfNReliability(n, k, r) {
    n = Math.round(n);
    k = Math.round(k);
    if (n < 1 || k < 1 || k > n) return NaN;
    var total = 0;
    for (var i = k; i <= n; i += 1) {
      total += binomialCoefficient(n, i) * Math.pow(r, i) * Math.pow(1 - r, n - i);
    }
    return total;
  }

  /**
   * 经典五单元桥式网络：
   * 边 R1: S-A, R2: A-T, R3: S-B, R4: B-T, R5: A-B
   * 对 32 种成功/失效状态做精确枚举，并由 S 到 T 的连通性判定系统成功。
   */
  function bridgeReliability(rs) {
    if (!rs || rs.length !== 5) return NaN;
    var edges = [
      ['S', 'A', rs[0]],
      ['A', 'T', rs[1]],
      ['S', 'B', rs[2]],
      ['B', 'T', rs[3]],
      ['A', 'B', rs[4]]
    ];
    var total = 0;

    for (var mask = 0; mask < 32; mask += 1) {
      var probability = 1;
      var active = [];
      for (var e = 0; e < 5; e += 1) {
        if (mask & (1 << e)) {
          probability *= edges[e][2];
          active.push(edges[e]);
        } else {
          probability *= 1 - edges[e][2];
        }
      }
      if (probability === 0) continue;

      var visited = { S: true };
      var queue = ['S'];
      while (queue.length) {
        var node = queue.shift();
        active.forEach(function (edge) {
          if (edge[0] === node && !visited[edge[1]]) {
            visited[edge[1]] = true;
            queue.push(edge[1]);
          } else if (edge[1] === node && !visited[edge[0]]) {
            visited[edge[0]] = true;
            queue.push(edge[0]);
          }
        });
      }
      if (visited.T) total += probability;
    }
    return total;
  }

  /* -------------------------------------------------------------------------
     Mixed-structure expression parser
     Grammar:
       parallel := series ('|' series)*
       series   := primary ('+' primary)*
       primary  := '(' parallel ')' | IDENTIFIER
     '+' means series, '|' means parallel.
     ------------------------------------------------------------------------- */

  function tokenizeExpression(expression) {
    if (!expression || !expression.trim()) {
      throw new Error('请输入结构表达式。');
    }
    var tokens = [];
    var source = expression.replace(/\s+/g, '');
    var i = 0;
    while (i < source.length) {
      var ch = source[i];
      if (/[A-Za-z]/.test(ch)) {
        var name = ch;
        i += 1;
        while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) {
          name += source[i];
          i += 1;
        }
        tokens.push({ type: 'id', value: name });
      } else if (ch === '+' || ch === '|' || ch === '(' || ch === ')') {
        tokens.push({ type: ch, value: ch });
        i += 1;
      } else {
        throw new Error('无法识别字符“' + ch + '”，仅支持字母、+、| 和括号。');
      }
    }
    return tokens;
  }

  function extractIdentifiers(expression) {
    var tokens = tokenizeExpression(expression);
    var seen = {};
    var result = [];
    tokens.forEach(function (token) {
      if (token.type === 'id' && !seen[token.value]) {
        seen[token.value] = true;
        result.push(token.value);
      }
    });
    return result;
  }

  function evaluateExpression(expression, values) {
    var tokens = tokenizeExpression(expression);
    var position = 0;

    function peek() {
      return tokens[position];
    }

    function consume(type) {
      if (peek() && peek().type === type) {
        position += 1;
        return true;
      }
      return false;
    }

    function parseParallel() {
      var value = parseSeries();
      while (consume('|')) {
        value = 1 - (1 - value) * (1 - parseSeries());
      }
      return value;
    }

    function parseSeries() {
      var value = parsePrimary();
      while (consume('+')) {
        value *= parsePrimary();
      }
      return value;
    }

    function parsePrimary() {
      if (consume('(')) {
        var inner = parseParallel();
        if (!consume(')')) throw new Error('括号不匹配。');
        return inner;
      }
      var token = peek();
      if (token && token.type === 'id') {
        position += 1;
        var r = values[token.value];
        if (typeof r !== 'number' || !isFinite(r)) {
          throw new Error('单元 ' + token.value + ' 尚未设置可靠度。');
        }
        return r;
      }
      throw new Error('表达式不完整，请检查运算符与括号。');
    }

    var result = parseParallel();
    if (position !== tokens.length) {
      throw new Error('表达式在“' + tokens[position].value + '”附近无法解析。');
    }
    return result;
  }

  /* -------------------------------------------------------------------------
     RBD model evaluation & importance
     ------------------------------------------------------------------------- */

  /**
   * 指数分布时间换算：已知 t0 时刻可靠度 r0，
   * R(t) = r0^(t/t0)
   */
  function reliabilityAtTime(r0, t0, t) {
    if (t <= 0) return 1;
    if (r0 >= 1) return 1;
    if (r0 <= 0) return 0;
    return Math.pow(r0, t / t0);
  }

  function evaluateRBD(model, t, t0) {
    t = t == null ? t0 : t;
    if (!(t0 > 0)) return NaN;

    function at(r) {
      return reliabilityAtTime(r, t0, t);
    }

    switch (model.type) {
      case 'series':
        return seriesReliability(model.rs.map(at));
      case 'parallel':
        return parallelReliability(model.rs.map(at));
      case 'kn':
        return kOutOfNReliability(model.n, model.k, at(model.r));
      case 'bridge':
        return bridgeReliability(model.rs.map(at));
      case 'mixed':
        var values = {};
        Object.keys(model.values).forEach(function (key) {
          values[key] = at(model.values[key]);
        });
        return evaluateExpression(model.expr, values);
      default:
        return NaN;
    }
  }

  function getModelVariables(model) {
    switch (model.type) {
      case 'series':
      case 'parallel':
        return model.rs.map(function (r, index) {
          return { label: '单元 ' + (index + 1), value: r, index: index };
        });
      case 'kn':
        return [{ label: '表决单元', value: model.r, index: 0 }];
      case 'bridge':
        return model.rs.map(function (r, index) {
          return { label: 'R' + (index + 1), value: r, index: index };
        });
      case 'mixed':
        return Object.keys(model.values).map(function (key, index) {
          return { label: key, value: model.values[key], index: index };
        });
      default:
        return [];
    }
  }

  function withVariable(model, index, value) {
    var clone = JSON.parse(JSON.stringify(model));
    if (clone.type === 'kn') {
      clone.r = value;
    } else if (clone.type === 'mixed') {
      var key = Object.keys(clone.values)[index];
      clone.values[key] = value;
    } else {
      clone.rs[index] = value;
    }
    return clone;
  }

  /**
   * Birnbaum 重要度：I_B(i) = ∂R_sys / ∂R_i
   * 采用中心差分： [R(R_i+h) - R(R_i-h)] / 2h
   */
  function birnbaumImportance(model, t0, index) {
    var variables = getModelVariables(model);
    var variable = variables[index];
    if (!variable) return NaN;
    var h = 1e-5;
    var upper = Math.min(1, variable.value + h);
    var lower = Math.max(0.000001, variable.value - h);
    var rPlus = evaluateRBD(withVariable(model, index, upper), t0, t0);
    var rMinus = evaluateRBD(withVariable(model, index, lower), t0, t0);
    return (rPlus - rMinus) / (upper - lower);
  }

  /* -------------------------------------------------------------------------
     MTBF / failure-rate / distribution conversions
     ------------------------------------------------------------------------- */

  /** 指数分布：R(t) = e^(-λt) */
  function exponentialReliability(lambda, t) {
    return Math.exp(-lambda * t);
  }

  /** MTBF = 1 / λ */
  function mtbfFromLambda(lambda) {
    return lambda > 0 ? 1 / lambda : Infinity;
  }

  /** λ = 1 / MTBF */
  function lambdaFromMTBF(mtbf) {
    return mtbf > 0 ? 1 / mtbf : Infinity;
  }

  /**
   * 将可用度换算为“9 的个数”：N = -log10(1 - A)
   */
  function ninesFromAvailability(availability) {
    if (availability >= 1) return Infinity;
    if (availability <= 0) return 0;
    return -Math.log10(1 - availability);
  }

  /** Lanczos approximation of the Gamma function, valid for z > 0. */
  function gammaFunction(z) {
    var coefficients = [
      0.99999999999980993,
      676.5203681218851,
      -1259.1392167224028,
      771.32342877765313,
      -176.61502916214059,
      12.507343278686905,
      -0.13857109526572012,
      9.9843695780195716e-6,
      1.5056327351493116e-7
    ];
    if (z < 0.5) {
      return Math.PI / (Math.sin(Math.PI * z) * gammaFunction(1 - z));
    }
    z -= 1;
    var x = coefficients[0];
    for (var i = 1; i < 9; i += 1) x += coefficients[i] / (z + i);
    var t = z + 7.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }

  /** Weibull 可靠度：R(t) = exp[-(t/η)^β] */
  function weibullReliability(t, beta, eta) {
    if (t <= 0) return 1;
    return Math.exp(-Math.pow(t / eta, beta));
  }

  /** Weibull 平均寿命：MTBF = η · Γ(1 + 1/β) */
  function weibullMTBF(beta, eta) {
    return eta * gammaFunction(1 + 1 / beta);
  }

  /** Weibull 瞬时失效率：λ(t) = (β/η) · (t/η)^(β-1) */
  function weibullHazard(t, beta, eta) {
    if (t <= 0) return beta === 1 ? 1 / eta : 0;
    return (beta / eta) * Math.pow(t / eta, beta - 1);
  }

  /* -------------------------------------------------------------------------
     Reliability prediction
     ------------------------------------------------------------------------- */

  /**
   * 元器件计数法：
   * λ_sys = Σ n_i · λ_b,i · π_Q,i · π_E,i   (单位: FIT, 1 FIT = 10^-6/h)
   * MTBF = 1 / λ_sys
   */
  function partsCountPrediction(parts, baseRates, qualityFactors, environmentFactors) {
    var totalFIT = 0;
    var itemCount = 0;
    parts.forEach(function (part) {
      var qty = Math.max(0, Number(part.qty) || 0);
      var base = Number(baseRates[part.type]) || 0;
      var quality = Number(qualityFactors[part.quality]) || 1;
      var environment = Number(environmentFactors[part.environment]) || 1;
      totalFIT += qty * base * quality * environment;
      itemCount += qty;
    });
    var lambda = totalFIT * 1e-6;
    return {
      totalFIT: totalFIT,
      lambda: lambda,
      mtbf: lambda > 0 ? 1 / lambda : Infinity,
      itemCount: itemCount
    };
  }

  function partContribution(part, baseRates, qualityFactors, environmentFactors) {
    var qty = Math.max(0, Number(part.qty) || 0);
    var base = Number(baseRates[part.type]) || 0;
    var quality = Number(qualityFactors[part.quality]) || 1;
    var environment = Number(environmentFactors[part.environment]) || 1;
    return qty * base * quality * environment;
  }

  /**
   * 相似产品法：
   * λ_new = λ_ref · C_complexity · C_environment
   * MTBF_new = MTBF_ref / (C_complexity · C_environment)
   */
  function similarProductPrediction(mtbfReference, complexityFactor, environmentFactor) {
    var lambdaReference = 1 / mtbfReference;
    var lambda = lambdaReference * complexityFactor * environmentFactor;
    return {
      lambda: lambda,
      mtbf: lambda > 0 ? 1 / lambda : Infinity,
      multiplier: complexityFactor * environmentFactor
    };
  }

  /* -------------------------------------------------------------------------
     Reliability allocation
     ------------------------------------------------------------------------- */

  function targetFailureRate(mode, targetR, targetMTBF, missionTime) {
    if (mode === 'mtbf') return 1 / targetMTBF;
    return -Math.log(targetR) / missionTime;
  }

  /**
   * 等分配：
   * λ_i = λ_sys / n,  R_i = e^(-λ_i t)
   *
   * 评分分配：
   * w_i = 复杂度_i × 环境严酷度_i / 技术水平_i
   * λ_i = λ_sys × w_i / Σw
   *
   * AGREE 分配（工程化变体）：
   * 以模块数与重要度综合权重 w_i = m_i / I_i，
   * λ_i = λ_sys × w_i / Σw，重要度越高、模块越少则分配越严。
   */
  function allocateReliability(options) {
    var units = options.units || [];
    var lambdaTotal = options.lambdaTotal;
    var method = options.method;
    var missionTime = options.missionTime;

    var weights = units.map(function (unit) {
      if (method === 'scoring') {
        var complexity = Math.min(10, Math.max(1, Number(unit.complexity) || 1));
        var technology = Math.min(10, Math.max(1, Number(unit.technology) || 1));
        var environment = Math.min(10, Math.max(1, Number(unit.environment) || 1));
        return (complexity * environment) / technology;
      }
      if (method === 'agree') {
        var modules = Math.max(0.1, Number(unit.modules) || 1);
        var importance = Math.min(1, Math.max(0.1, Number(unit.importance) || 1));
        return modules / importance;
      }
      return 1;
    });

    var totalWeight = weights.reduce(function (sum, weight) {
      return sum + weight;
    }, 0);
    if (!(totalWeight > 0)) totalWeight = units.length || 1;

    var items = units.map(function (unit, index) {
      var weight = method === 'equal' ? 1 : weights[index] / totalWeight;
      var lambda = method === 'equal'
        ? lambdaTotal / units.length
        : lambdaTotal * weight;
      return {
        name: unit.name,
        weight: weight,
        lambda: lambda,
        reliability: Math.exp(-lambda * missionTime),
        mtbf: lambda > 0 ? 1 / lambda : Infinity
      };
    });

    return {
      items: items,
      systemLambda: lambdaTotal,
      systemReliability: Math.exp(-lambdaTotal * missionTime),
      systemMTBF: lambdaTotal > 0 ? 1 / lambdaTotal : Infinity,
      weights: weights
    };
  }

  global.ReliabilityCalc = {
    MAX_UNITS: MAX_UNITS,
    seriesReliability: seriesReliability,
    parallelReliability: parallelReliability,
    binomialCoefficient: binomialCoefficient,
    kOutOfNReliability: kOutOfNReliability,
    bridgeReliability: bridgeReliability,
    tokenizeExpression: tokenizeExpression,
    extractIdentifiers: extractIdentifiers,
    evaluateExpression: evaluateExpression,
    reliabilityAtTime: reliabilityAtTime,
    evaluateRBD: evaluateRBD,
    getModelVariables: getModelVariables,
    birnbaumImportance: birnbaumImportance,
    exponentialReliability: exponentialReliability,
    mtbfFromLambda: mtbfFromLambda,
    lambdaFromMTBF: lambdaFromMTBF,
    ninesFromAvailability: ninesFromAvailability,
    gammaFunction: gammaFunction,
    weibullReliability: weibullReliability,
    weibullMTBF: weibullMTBF,
    weibullHazard: weibullHazard,
    partsCountPrediction: partsCountPrediction,
    partContribution: partContribution,
    similarProductPrediction: similarProductPrediction,
    targetFailureRate: targetFailureRate,
    allocateReliability: allocateReliability
  };
})(typeof window !== 'undefined' ? window : globalThis);
