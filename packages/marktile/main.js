'use strict';
const Sortable = (function () {
  var module = { exports: {} }; var exports = module.exports;
/*! Sortable 1.15.6 - MIT | git://github.com/SortableJS/Sortable.git */
!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define(e):(t=t||self).Sortable=e()}(this,function(){"use strict";function e(e,t){var n,o=Object.keys(e);return Object.getOwnPropertySymbols&&(n=Object.getOwnPropertySymbols(e),t&&(n=n.filter(function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable})),o.push.apply(o,n)),o}function I(o){for(var t=1;t<arguments.length;t++){var i=null!=arguments[t]?arguments[t]:{};t%2?e(Object(i),!0).forEach(function(t){var e,n;e=o,t=i[n=t],n in e?Object.defineProperty(e,n,{value:t,enumerable:!0,configurable:!0,writable:!0}):e[n]=t}):Object.getOwnPropertyDescriptors?Object.defineProperties(o,Object.getOwnPropertyDescriptors(i)):e(Object(i)).forEach(function(t){Object.defineProperty(o,t,Object.getOwnPropertyDescriptor(i,t))})}return o}function o(t){return(o="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t})(t)}function a(){return(a=Object.assign||function(t){for(var e=1;e<arguments.length;e++){var n,o=arguments[e];for(n in o)Object.prototype.hasOwnProperty.call(o,n)&&(t[n]=o[n])}return t}).apply(this,arguments)}function i(t,e){if(null==t)return{};var n,o=function(t,e){if(null==t)return{};for(var n,o={},i=Object.keys(t),r=0;r<i.length;r++)n=i[r],0<=e.indexOf(n)||(o[n]=t[n]);return o}(t,e);if(Object.getOwnPropertySymbols)for(var i=Object.getOwnPropertySymbols(t),r=0;r<i.length;r++)n=i[r],0<=e.indexOf(n)||Object.prototype.propertyIsEnumerable.call(t,n)&&(o[n]=t[n]);return o}function r(t){return function(t){if(Array.isArray(t))return l(t)}(t)||function(t){if("undefined"!=typeof Symbol&&null!=t[Symbol.iterator]||null!=t["@@iterator"])return Array.from(t)}(t)||function(t,e){if(t){if("string"==typeof t)return l(t,e);var n=Object.prototype.toString.call(t).slice(8,-1);return"Map"===(n="Object"===n&&t.constructor?t.constructor.name:n)||"Set"===n?Array.from(t):"Arguments"===n||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)?l(t,e):void 0}}(t)||function(){throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}()}function l(t,e){(null==e||e>t.length)&&(e=t.length);for(var n=0,o=new Array(e);n<e;n++)o[n]=t[n];return o}function t(t){if("undefined"!=typeof window&&window.navigator)return!!navigator.userAgent.match(t)}var y=t(/(?:Trident.*rv[ :]?11\.|msie|iemobile|Windows Phone)/i),w=t(/Edge/i),s=t(/firefox/i),u=t(/safari/i)&&!t(/chrome/i)&&!t(/android/i),c=t(/iP(ad|od|hone)/i),n=t(/chrome/i)&&t(/android/i),d={capture:!1,passive:!1};function h(t,e,n){t.addEventListener(e,n,!y&&d)}function p(t,e,n){t.removeEventListener(e,n,!y&&d)}function f(t,e){if(e&&(">"===e[0]&&(e=e.substring(1)),t))try{if(t.matches)return t.matches(e);if(t.msMatchesSelector)return t.msMatchesSelector(e);if(t.webkitMatchesSelector)return t.webkitMatchesSelector(e)}catch(t){return}}function g(t){return t.host&&t!==document&&t.host.nodeType?t.host:t.parentNode}function P(t,e,n,o){if(t){n=n||document;do{if(null!=e&&(">"!==e[0]||t.parentNode===n)&&f(t,e)||o&&t===n)return t}while(t!==n&&(t=g(t)))}return null}var m,v=/\s+/g;function k(t,e,n){var o;t&&e&&(t.classList?t.classList[n?"add":"remove"](e):(o=(" "+t.className+" ").replace(v," ").replace(" "+e+" "," "),t.className=(o+(n?" "+e:"")).replace(v," ")))}function R(t,e,n){var o=t&&t.style;if(o){if(void 0===n)return document.defaultView&&document.defaultView.getComputedStyle?n=document.defaultView.getComputedStyle(t,""):t.currentStyle&&(n=t.currentStyle),void 0===e?n:n[e];o[e=!(e in o||-1!==e.indexOf("webkit"))?"-webkit-"+e:e]=n+("string"==typeof n?"":"px")}}function b(t,e){var n="";if("string"==typeof t)n=t;else do{var o=R(t,"transform")}while(o&&"none"!==o&&(n=o+" "+n),!e&&(t=t.parentNode));var i=window.DOMMatrix||window.WebKitCSSMatrix||window.CSSMatrix||window.MSCSSMatrix;return i&&new i(n)}function D(t,e,n){if(t){var o=t.getElementsByTagName(e),i=0,r=o.length;if(n)for(;i<r;i++)n(o[i],i);return o}return[]}function O(){var t=document.scrollingElement;return t||document.documentElement}function X(t,e,n,o,i){if(t.getBoundingClientRect||t===window){var r,a,l,s,c,u,d=t!==window&&t.parentNode&&t!==O()?(a=(r=t.getBoundingClientRect()).top,l=r.left,s=r.bottom,c=r.right,u=r.height,r.width):(l=a=0,s=window.innerHeight,c=window.innerWidth,u=window.innerHeight,window.innerWidth);if((e||n)&&t!==window&&(i=i||t.parentNode,!y))do{if(i&&i.getBoundingClientRect&&("none"!==R(i,"transform")||n&&"static"!==R(i,"position"))){var h=i.getBoundingClientRect();a-=h.top+parseInt(R(i,"border-top-width")),l-=h.left+parseInt(R(i,"border-left-width")),s=a+r.height,c=l+r.width;break}}while(i=i.parentNode);return o&&t!==window&&(o=(e=b(i||t))&&e.a,t=e&&e.d,e&&(s=(a/=t)+(u/=t),c=(l/=o)+(d/=o))),{top:a,left:l,bottom:s,right:c,width:d,height:u}}}function Y(t,e,n){for(var o=M(t,!0),i=X(t)[e];o;){var r=X(o)[n];if(!("top"===n||"left"===n?r<=i:i<=r))return o;if(o===O())break;o=M(o,!1)}return!1}function B(t,e,n,o){for(var i=0,r=0,a=t.children;r<a.length;){if("none"!==a[r].style.display&&a[r]!==jt.ghost&&(o||a[r]!==jt.dragged)&&P(a[r],n.draggable,t,!1)){if(i===e)return a[r];i++}r++}return null}function F(t,e){for(var n=t.lastElementChild;n&&(n===jt.ghost||"none"===R(n,"display")||e&&!f(n,e));)n=n.previousElementSibling;return n||null}function j(t,e){var n=0;if(!t||!t.parentNode)return-1;for(;t=t.previousElementSibling;)"TEMPLATE"===t.nodeName.toUpperCase()||t===jt.clone||e&&!f(t,e)||n++;return n}function E(t){var e=0,n=0,o=O();if(t)do{var i=b(t),r=i.a,i=i.d}while(e+=t.scrollLeft*r,n+=t.scrollTop*i,t!==o&&(t=t.parentNode));return[e,n]}function M(t,e){if(!t||!t.getBoundingClientRect)return O();var n=t,o=!1;do{if(n.clientWidth<n.scrollWidth||n.clientHeight<n.scrollHeight){var i=R(n);if(n.clientWidth<n.scrollWidth&&("auto"==i.overflowX||"scroll"==i.overflowX)||n.clientHeight<n.scrollHeight&&("auto"==i.overflowY||"scroll"==i.overflowY)){if(!n.getBoundingClientRect||n===document.body)return O();if(o||e)return n;o=!0}}}while(n=n.parentNode);return O()}function S(t,e){return Math.round(t.top)===Math.round(e.top)&&Math.round(t.left)===Math.round(e.left)&&Math.round(t.height)===Math.round(e.height)&&Math.round(t.width)===Math.round(e.width)}function _(e,n){return function(){var t;m||(1===(t=arguments).length?e.call(this,t[0]):e.apply(this,t),m=setTimeout(function(){m=void 0},n))}}function H(t,e,n){t.scrollLeft+=e,t.scrollTop+=n}function C(t){var e=window.Polymer,n=window.jQuery||window.Zepto;return e&&e.dom?e.dom(t).cloneNode(!0):n?n(t).clone(!0)[0]:t.cloneNode(!0)}function T(t,e){R(t,"position","absolute"),R(t,"top",e.top),R(t,"left",e.left),R(t,"width",e.width),R(t,"height",e.height)}function x(t){R(t,"position",""),R(t,"top",""),R(t,"left",""),R(t,"width",""),R(t,"height","")}function L(n,o,i){var r={};return Array.from(n.children).forEach(function(t){var e;P(t,o.draggable,n,!1)&&!t.animated&&t!==i&&(e=X(t),r.left=Math.min(null!==(t=r.left)&&void 0!==t?t:1/0,e.left),r.top=Math.min(null!==(t=r.top)&&void 0!==t?t:1/0,e.top),r.right=Math.max(null!==(t=r.right)&&void 0!==t?t:-1/0,e.right),r.bottom=Math.max(null!==(t=r.bottom)&&void 0!==t?t:-1/0,e.bottom))}),r.width=r.right-r.left,r.height=r.bottom-r.top,r.x=r.left,r.y=r.top,r}var K="Sortable"+(new Date).getTime();function A(){var e,o=[];return{captureAnimationState:function(){o=[],this.options.animation&&[].slice.call(this.el.children).forEach(function(t){var e,n;"none"!==R(t,"display")&&t!==jt.ghost&&(o.push({target:t,rect:X(t)}),e=I({},o[o.length-1].rect),!t.thisAnimationDuration||(n=b(t,!0))&&(e.top-=n.f,e.left-=n.e),t.fromRect=e)})},addAnimationState:function(t){o.push(t)},removeAnimationState:function(t){o.splice(function(t,e){for(var n in t)if(t.hasOwnProperty(n))for(var o in e)if(e.hasOwnProperty(o)&&e[o]===t[n][o])return Number(n);return-1}(o,{target:t}),1)},animateAll:function(t){var c=this;if(!this.options.animation)return clearTimeout(e),void("function"==typeof t&&t());var u=!1,d=0;o.forEach(function(t){var e=0,n=t.target,o=n.fromRect,i=X(n),r=n.prevFromRect,a=n.prevToRect,l=t.rect,s=b(n,!0);s&&(i.top-=s.f,i.left-=s.e),n.toRect=i,n.thisAnimationDuration&&S(r,i)&&!S(o,i)&&(l.top-i.top)/(l.left-i.left)==(o.top-i.top)/(o.left-i.left)&&(t=l,s=r,r=a,a=c.options,e=Math.sqrt(Math.pow(s.top-t.top,2)+Math.pow(s.left-t.left,2))/Math.sqrt(Math.pow(s.top-r.top,2)+Math.pow(s.left-r.left,2))*a.animation),S(i,o)||(n.prevFromRect=o,n.prevToRect=i,e=e||c.options.animation,c.animate(n,l,i,e)),e&&(u=!0,d=Math.max(d,e),clearTimeout(n.animationResetTimer),n.animationResetTimer=setTimeout(function(){n.animationTime=0,n.prevFromRect=null,n.fromRect=null,n.prevToRect=null,n.thisAnimationDuration=null},e),n.thisAnimationDuration=e)}),clearTimeout(e),u?e=setTimeout(function(){"function"==typeof t&&t()},d):"function"==typeof t&&t(),o=[]},animate:function(t,e,n,o){var i,r;o&&(R(t,"transition",""),R(t,"transform",""),i=(r=b(this.el))&&r.a,r=r&&r.d,i=(e.left-n.left)/(i||1),r=(e.top-n.top)/(r||1),t.animatingX=!!i,t.animatingY=!!r,R(t,"transform","translate3d("+i+"px,"+r+"px,0)"),this.forRepaintDummy=t.offsetWidth,R(t,"transition","transform "+o+"ms"+(this.options.easing?" "+this.options.easing:"")),R(t,"transform","translate3d(0,0,0)"),"number"==typeof t.animated&&clearTimeout(t.animated),t.animated=setTimeout(function(){R(t,"transition",""),R(t,"transform",""),t.animated=!1,t.animatingX=!1,t.animatingY=!1},o))}}}var N=[],W={initializeByDefault:!0},z={mount:function(e){for(var t in W)!W.hasOwnProperty(t)||t in e||(e[t]=W[t]);N.forEach(function(t){if(t.pluginName===e.pluginName)throw"Sortable: Cannot mount plugin ".concat(e.pluginName," more than once")}),N.push(e)},pluginEvent:function(e,n,o){var t=this;this.eventCanceled=!1,o.cancel=function(){t.eventCanceled=!0};var i=e+"Global";N.forEach(function(t){n[t.pluginName]&&(n[t.pluginName][i]&&n[t.pluginName][i](I({sortable:n},o)),n.options[t.pluginName]&&n[t.pluginName][e]&&n[t.pluginName][e](I({sortable:n},o)))})},initializePlugins:function(n,o,i,t){for(var e in N.forEach(function(t){var e=t.pluginName;(n.options[e]||t.initializeByDefault)&&((t=new t(n,o,n.options)).sortable=n,t.options=n.options,n[e]=t,a(i,t.defaults))}),n.options){var r;n.options.hasOwnProperty(e)&&(void 0!==(r=this.modifyOption(n,e,n.options[e]))&&(n.options[e]=r))}},getEventProperties:function(e,n){var o={};return N.forEach(function(t){"function"==typeof t.eventProperties&&a(o,t.eventProperties.call(n[t.pluginName],e))}),o},modifyOption:function(e,n,o){var i;return N.forEach(function(t){e[t.pluginName]&&t.optionListeners&&"function"==typeof t.optionListeners[n]&&(i=t.optionListeners[n].call(e[t.pluginName],o))}),i}};function G(t){var e=t.sortable,n=t.rootEl,o=t.name,i=t.targetEl,r=t.cloneEl,a=t.toEl,l=t.fromEl,s=t.oldIndex,c=t.newIndex,u=t.oldDraggableIndex,d=t.newDraggableIndex,h=t.originalEvent,p=t.putSortable,f=t.extraEventProperties;if(e=e||n&&n[K]){var g,m=e.options,t="on"+o.charAt(0).toUpperCase()+o.substr(1);!window.CustomEvent||y||w?(g=document.createEvent("Event")).initEvent(o,!0,!0):g=new CustomEvent(o,{bubbles:!0,cancelable:!0}),g.to=a||n,g.from=l||n,g.item=i||n,g.clone=r,g.oldIndex=s,g.newIndex=c,g.oldDraggableIndex=u,g.newDraggableIndex=d,g.originalEvent=h,g.pullMode=p?p.lastPutMode:void 0;var v,b=I(I({},f),z.getEventProperties(o,e));for(v in b)g[v]=b[v];n&&n.dispatchEvent(g),m[t]&&m[t].call(e,g)}}function U(t,e){var n=(o=2<arguments.length&&void 0!==arguments[2]?arguments[2]:{}).evt,o=i(o,q);z.pluginEvent.bind(jt)(t,e,I({dragEl:Z,parentEl:$,ghostEl:Q,rootEl:J,nextEl:tt,lastDownEl:et,cloneEl:nt,cloneHidden:ot,dragStarted:mt,putSortable:ct,activeSortable:jt.active,originalEvent:n,oldIndex:it,oldDraggableIndex:at,newIndex:rt,newDraggableIndex:lt,hideGhostForTarget:Xt,unhideGhostForTarget:Yt,cloneNowHidden:function(){ot=!0},cloneNowShown:function(){ot=!1},dispatchSortableEvent:function(t){V({sortable:e,name:t,originalEvent:n})}},o))}var q=["evt"];function V(t){G(I({putSortable:ct,cloneEl:nt,targetEl:Z,rootEl:J,oldIndex:it,oldDraggableIndex:at,newIndex:rt,newDraggableIndex:lt},t))}var Z,$,Q,J,tt,et,nt,ot,it,rt,at,lt,st,ct,ut,dt,ht,pt,ft,gt,mt,vt,bt,yt,wt,Dt=!1,Et=!1,St=[],_t=!1,Ct=!1,Tt=[],xt=!1,Ot=[],Mt="undefined"!=typeof document,At=c,Nt=w||y?"cssFloat":"float",It=Mt&&!n&&!c&&"draggable"in document.createElement("div"),Pt=function(){if(Mt){if(y)return!1;var t=document.createElement("x");return t.style.cssText="pointer-events:auto","auto"===t.style.pointerEvents}}(),kt=function(t,e){var n=R(t),o=parseInt(n.width)-parseInt(n.paddingLeft)-parseInt(n.paddingRight)-parseInt(n.borderLeftWidth)-parseInt(n.borderRightWidth),i=B(t,0,e),r=B(t,1,e),a=i&&R(i),l=r&&R(r),s=a&&parseInt(a.marginLeft)+parseInt(a.marginRight)+X(i).width,t=l&&parseInt(l.marginLeft)+parseInt(l.marginRight)+X(r).width;if("flex"===n.display)return"column"===n.flexDirection||"column-reverse"===n.flexDirection?"vertical":"horizontal";if("grid"===n.display)return n.gridTemplateColumns.split(" ").length<=1?"vertical":"horizontal";if(i&&a.float&&"none"!==a.float){e="left"===a.float?"left":"right";return!r||"both"!==l.clear&&l.clear!==e?"horizontal":"vertical"}return i&&("block"===a.display||"flex"===a.display||"table"===a.display||"grid"===a.display||o<=s&&"none"===n[Nt]||r&&"none"===n[Nt]&&o<s+t)?"vertical":"horizontal"},Rt=function(t){function l(r,a){return function(t,e,n,o){var i=t.options.group.name&&e.options.group.name&&t.options.group.name===e.options.group.name;if(null==r&&(a||i))return!0;if(null==r||!1===r)return!1;if(a&&"clone"===r)return r;if("function"==typeof r)return l(r(t,e,n,o),a)(t,e,n,o);e=(a?t:e).options.group.name;return!0===r||"string"==typeof r&&r===e||r.join&&-1<r.indexOf(e)}}var e={},n=t.group;n&&"object"==o(n)||(n={name:n}),e.name=n.name,e.checkPull=l(n.pull,!0),e.checkPut=l(n.put),e.revertClone=n.revertClone,t.group=e},Xt=function(){!Pt&&Q&&R(Q,"display","none")},Yt=function(){!Pt&&Q&&R(Q,"display","")};Mt&&!n&&document.addEventListener("click",function(t){if(Et)return t.preventDefault(),t.stopPropagation&&t.stopPropagation(),t.stopImmediatePropagation&&t.stopImmediatePropagation(),Et=!1},!0);function Bt(t){if(Z){t=t.touches?t.touches[0]:t;var e=(i=t.clientX,r=t.clientY,St.some(function(t){var e=t[K].options.emptyInsertThreshold;if(e&&!F(t)){var n=X(t),o=i>=n.left-e&&i<=n.right+e,e=r>=n.top-e&&r<=n.bottom+e;return o&&e?a=t:void 0}}),a);if(e){var n,o={};for(n in t)t.hasOwnProperty(n)&&(o[n]=t[n]);o.target=o.rootEl=e,o.preventDefault=void 0,o.stopPropagation=void 0,e[K]._onDragOver(o)}}var i,r,a}function Ft(t){Z&&Z.parentNode[K]._isOutsideThisEl(t.target)}function jt(t,e){if(!t||!t.nodeType||1!==t.nodeType)throw"Sortable: `el` must be an HTMLElement, not ".concat({}.toString.call(t));this.el=t,this.options=e=a({},e),t[K]=this;var n,o,i={group:null,sort:!0,disabled:!1,store:null,handle:null,draggable:/^[uo]l$/i.test(t.nodeName)?">li":">*",swapThreshold:1,invertSwap:!1,invertedSwapThreshold:null,removeCloneOnHide:!0,direction:function(){return kt(t,this.options)},ghostClass:"sortable-ghost",chosenClass:"sortable-chosen",dragClass:"sortable-drag",ignore:"a, img",filter:null,preventOnFilter:!0,animation:0,easing:null,setData:function(t,e){t.setData("Text",e.textContent)},dropBubble:!1,dragoverBubble:!1,dataIdAttr:"data-id",delay:0,delayOnTouchOnly:!1,touchStartThreshold:(Number.parseInt?Number:window).parseInt(window.devicePixelRatio,10)||1,forceFallback:!1,fallbackClass:"sortable-fallback",fallbackOnBody:!1,fallbackTolerance:0,fallbackOffset:{x:0,y:0},supportPointer:!1!==jt.supportPointer&&"PointerEvent"in window&&(!u||c),emptyInsertThreshold:5};for(n in z.initializePlugins(this,t,i),i)n in e||(e[n]=i[n]);for(o in Rt(e),this)"_"===o.charAt(0)&&"function"==typeof this[o]&&(this[o]=this[o].bind(this));this.nativeDraggable=!e.forceFallback&&It,this.nativeDraggable&&(this.options.touchStartThreshold=1),e.supportPointer?h(t,"pointerdown",this._onTapStart):(h(t,"mousedown",this._onTapStart),h(t,"touchstart",this._onTapStart)),this.nativeDraggable&&(h(t,"dragover",this),h(t,"dragenter",this)),St.push(this.el),e.store&&e.store.get&&this.sort(e.store.get(this)||[]),a(this,A())}function Ht(t,e,n,o,i,r,a,l){var s,c,u=t[K],d=u.options.onMove;return!window.CustomEvent||y||w?(s=document.createEvent("Event")).initEvent("move",!0,!0):s=new CustomEvent("move",{bubbles:!0,cancelable:!0}),s.to=e,s.from=t,s.dragged=n,s.draggedRect=o,s.related=i||e,s.relatedRect=r||X(e),s.willInsertAfter=l,s.originalEvent=a,t.dispatchEvent(s),c=d?d.call(u,s,a):c}function Lt(t){t.draggable=!1}function Kt(){xt=!1}function Wt(t){return setTimeout(t,0)}function zt(t){return clearTimeout(t)}jt.prototype={constructor:jt,_isOutsideThisEl:function(t){this.el.contains(t)||t===this.el||(vt=null)},_getDirection:function(t,e){return"function"==typeof this.options.direction?this.options.direction.call(this,t,e,Z):this.options.direction},_onTapStart:function(e){if(e.cancelable){var n=this,o=this.el,t=this.options,i=t.preventOnFilter,r=e.type,a=e.touches&&e.touches[0]||e.pointerType&&"touch"===e.pointerType&&e,l=(a||e).target,s=e.target.shadowRoot&&(e.path&&e.path[0]||e.composedPath&&e.composedPath()[0])||l,c=t.filter;if(!function(t){Ot.length=0;var e=t.getElementsByTagName("input"),n=e.length;for(;n--;){var o=e[n];o.checked&&Ot.push(o)}}(o),!Z&&!(/mousedown|pointerdown/.test(r)&&0!==e.button||t.disabled)&&!s.isContentEditable&&(this.nativeDraggable||!u||!l||"SELECT"!==l.tagName.toUpperCase())&&!((l=P(l,t.draggable,o,!1))&&l.animated||et===l)){if(it=j(l),at=j(l,t.draggable),"function"==typeof c){if(c.call(this,e,l,this))return V({sortable:n,rootEl:s,name:"filter",targetEl:l,toEl:o,fromEl:o}),U("filter",n,{evt:e}),void(i&&e.preventDefault())}else if(c=c&&c.split(",").some(function(t){if(t=P(s,t.trim(),o,!1))return V({sortable:n,rootEl:t,name:"filter",targetEl:l,fromEl:o,toEl:o}),U("filter",n,{evt:e}),!0}))return void(i&&e.preventDefault());t.handle&&!P(s,t.handle,o,!1)||this._prepareDragStart(e,a,l)}}},_prepareDragStart:function(t,e,n){var o,i=this,r=i.el,a=i.options,l=r.ownerDocument;n&&!Z&&n.parentNode===r&&(o=X(n),J=r,$=(Z=n).parentNode,tt=Z.nextSibling,et=n,st=a.group,ut={target:jt.dragged=Z,clientX:(e||t).clientX,clientY:(e||t).clientY},ft=ut.clientX-o.left,gt=ut.clientY-o.top,this._lastX=(e||t).clientX,this._lastY=(e||t).clientY,Z.style["will-change"]="all",o=function(){U("delayEnded",i,{evt:t}),jt.eventCanceled?i._onDrop():(i._disableDelayedDragEvents(),!s&&i.nativeDraggable&&(Z.draggable=!0),i._triggerDragStart(t,e),V({sortable:i,name:"choose",originalEvent:t}),k(Z,a.chosenClass,!0))},a.ignore.split(",").forEach(function(t){D(Z,t.trim(),Lt)}),h(l,"dragover",Bt),h(l,"mousemove",Bt),h(l,"touchmove",Bt),a.supportPointer?(h(l,"pointerup",i._onDrop),this.nativeDraggable||h(l,"pointercancel",i._onDrop)):(h(l,"mouseup",i._onDrop),h(l,"touchend",i._onDrop),h(l,"touchcancel",i._onDrop)),s&&this.nativeDraggable&&(this.options.touchStartThreshold=4,Z.draggable=!0),U("delayStart",this,{evt:t}),!a.delay||a.delayOnTouchOnly&&!e||this.nativeDraggable&&(w||y)?o():jt.eventCanceled?this._onDrop():(a.supportPointer?(h(l,"pointerup",i._disableDelayedDrag),h(l,"pointercancel",i._disableDelayedDrag)):(h(l,"mouseup",i._disableDelayedDrag),h(l,"touchend",i._disableDelayedDrag),h(l,"touchcancel",i._disableDelayedDrag)),h(l,"mousemove",i._delayedDragTouchMoveHandler),h(l,"touchmove",i._delayedDragTouchMoveHandler),a.supportPointer&&h(l,"pointermove",i._delayedDragTouchMoveHandler),i._dragStartTimer=setTimeout(o,a.delay)))},_delayedDragTouchMoveHandler:function(t){t=t.touches?t.touches[0]:t;Math.max(Math.abs(t.clientX-this._lastX),Math.abs(t.clientY-this._lastY))>=Math.floor(this.options.touchStartThreshold/(this.nativeDraggable&&window.devicePixelRatio||1))&&this._disableDelayedDrag()},_disableDelayedDrag:function(){Z&&Lt(Z),clearTimeout(this._dragStartTimer),this._disableDelayedDragEvents()},_disableDelayedDragEvents:function(){var t=this.el.ownerDocument;p(t,"mouseup",this._disableDelayedDrag),p(t,"touchend",this._disableDelayedDrag),p(t,"touchcancel",this._disableDelayedDrag),p(t,"pointerup",this._disableDelayedDrag),p(t,"pointercancel",this._disableDelayedDrag),p(t,"mousemove",this._delayedDragTouchMoveHandler),p(t,"touchmove",this._delayedDragTouchMoveHandler),p(t,"pointermove",this._delayedDragTouchMoveHandler)},_triggerDragStart:function(t,e){e=e||"touch"==t.pointerType&&t,!this.nativeDraggable||e?this.options.supportPointer?h(document,"pointermove",this._onTouchMove):h(document,e?"touchmove":"mousemove",this._onTouchMove):(h(Z,"dragend",this),h(J,"dragstart",this._onDragStart));try{document.selection?Wt(function(){document.selection.empty()}):window.getSelection().removeAllRanges()}catch(t){}},_dragStarted:function(t,e){var n;Dt=!1,J&&Z?(U("dragStarted",this,{evt:e}),this.nativeDraggable&&h(document,"dragover",Ft),n=this.options,t||k(Z,n.dragClass,!1),k(Z,n.ghostClass,!0),jt.active=this,t&&this._appendGhost(),V({sortable:this,name:"start",originalEvent:e})):this._nulling()},_emulateDragOver:function(){if(dt){this._lastX=dt.clientX,this._lastY=dt.clientY,Xt();for(var t=document.elementFromPoint(dt.clientX,dt.clientY),e=t;t&&t.shadowRoot&&(t=t.shadowRoot.elementFromPoint(dt.clientX,dt.clientY))!==e;)e=t;if(Z.parentNode[K]._isOutsideThisEl(t),e)do{if(e[K])if(e[K]._onDragOver({clientX:dt.clientX,clientY:dt.clientY,target:t,rootEl:e})&&!this.options.dragoverBubble)break}while(e=g(t=e));Yt()}},_onTouchMove:function(t){if(ut){var e=this.options,n=e.fallbackTolerance,o=e.fallbackOffset,i=t.touches?t.touches[0]:t,r=Q&&b(Q,!0),a=Q&&r&&r.a,l=Q&&r&&r.d,e=At&&wt&&E(wt),a=(i.clientX-ut.clientX+o.x)/(a||1)+(e?e[0]-Tt[0]:0)/(a||1),l=(i.clientY-ut.clientY+o.y)/(l||1)+(e?e[1]-Tt[1]:0)/(l||1);if(!jt.active&&!Dt){if(n&&Math.max(Math.abs(i.clientX-this._lastX),Math.abs(i.clientY-this._lastY))<n)return;this._onDragStart(t,!0)}Q&&(r?(r.e+=a-(ht||0),r.f+=l-(pt||0)):r={a:1,b:0,c:0,d:1,e:a,f:l},r="matrix(".concat(r.a,",").concat(r.b,",").concat(r.c,",").concat(r.d,",").concat(r.e,",").concat(r.f,")"),R(Q,"webkitTransform",r),R(Q,"mozTransform",r),R(Q,"msTransform",r),R(Q,"transform",r),ht=a,pt=l,dt=i),t.cancelable&&t.preventDefault()}},_appendGhost:function(){if(!Q){var t=this.options.fallbackOnBody?document.body:J,e=X(Z,!0,At,!0,t),n=this.options;if(At){for(wt=t;"static"===R(wt,"position")&&"none"===R(wt,"transform")&&wt!==document;)wt=wt.parentNode;wt!==document.body&&wt!==document.documentElement?(wt===document&&(wt=O()),e.top+=wt.scrollTop,e.left+=wt.scrollLeft):wt=O(),Tt=E(wt)}k(Q=Z.cloneNode(!0),n.ghostClass,!1),k(Q,n.fallbackClass,!0),k(Q,n.dragClass,!0),R(Q,"transition",""),R(Q,"transform",""),R(Q,"box-sizing","border-box"),R(Q,"margin",0),R(Q,"top",e.top),R(Q,"left",e.left),R(Q,"width",e.width),R(Q,"height",e.height),R(Q,"opacity","0.8"),R(Q,"position",At?"absolute":"fixed"),R(Q,"zIndex","100000"),R(Q,"pointerEvents","none"),jt.ghost=Q,t.appendChild(Q),R(Q,"transform-origin",ft/parseInt(Q.style.width)*100+"% "+gt/parseInt(Q.style.height)*100+"%")}},_onDragStart:function(t,e){var n=this,o=t.dataTransfer,i=n.options;U("dragStart",this,{evt:t}),jt.eventCanceled?this._onDrop():(U("setupClone",this),jt.eventCanceled||((nt=C(Z)).removeAttribute("id"),nt.draggable=!1,nt.style["will-change"]="",this._hideClone(),k(nt,this.options.chosenClass,!1),jt.clone=nt),n.cloneId=Wt(function(){U("clone",n),jt.eventCanceled||(n.options.removeCloneOnHide||J.insertBefore(nt,Z),n._hideClone(),V({sortable:n,name:"clone"}))}),e||k(Z,i.dragClass,!0),e?(Et=!0,n._loopId=setInterval(n._emulateDragOver,50)):(p(document,"mouseup",n._onDrop),p(document,"touchend",n._onDrop),p(document,"touchcancel",n._onDrop),o&&(o.effectAllowed="move",i.setData&&i.setData.call(n,o,Z)),h(document,"drop",n),R(Z,"transform","translateZ(0)")),Dt=!0,n._dragStartId=Wt(n._dragStarted.bind(n,e,t)),h(document,"selectstart",n),mt=!0,window.getSelection().removeAllRanges(),u&&R(document.body,"user-select","none"))},_onDragOver:function(n){var o,i,r,t,e,a=this.el,l=n.target,s=this.options,c=s.group,u=jt.active,d=st===c,h=s.sort,p=ct||u,f=this,g=!1;if(!xt){if(void 0!==n.preventDefault&&n.cancelable&&n.preventDefault(),l=P(l,s.draggable,a,!0),O("dragOver"),jt.eventCanceled)return g;if(Z.contains(n.target)||l.animated&&l.animatingX&&l.animatingY||f._ignoreWhileAnimating===l)return A(!1);if(Et=!1,u&&!s.disabled&&(d?h||(i=$!==J):ct===this||(this.lastPutMode=st.checkPull(this,u,Z,n))&&c.checkPut(this,u,Z,n))){if(r="vertical"===this._getDirection(n,l),o=X(Z),O("dragOverValid"),jt.eventCanceled)return g;if(i)return $=J,M(),this._hideClone(),O("revert"),jt.eventCanceled||(tt?J.insertBefore(Z,tt):J.appendChild(Z)),A(!0);var m=F(a,s.draggable);if(m&&(S=n,c=r,x=X(F((E=this).el,E.options.draggable)),E=L(E.el,E.options,Q),!(c?S.clientX>E.right+10||S.clientY>x.bottom&&S.clientX>x.left:S.clientY>E.bottom+10||S.clientX>x.right&&S.clientY>x.top)||m.animated)){if(m&&(t=n,e=r,C=X(B((_=this).el,0,_.options,!0)),_=L(_.el,_.options,Q),e?t.clientX<_.left-10||t.clientY<C.top&&t.clientX<C.right:t.clientY<_.top-10||t.clientY<C.bottom&&t.clientX<C.left)){var v=B(a,0,s,!0);if(v===Z)return A(!1);if(D=X(l=v),!1!==Ht(J,a,Z,o,l,D,n,!1))return M(),a.insertBefore(Z,v),$=a,N(),A(!0)}else if(l.parentNode===a){var b,y,w,D=X(l),E=Z.parentNode!==a,S=(S=Z.animated&&Z.toRect||o,x=l.animated&&l.toRect||D,_=(e=r)?S.left:S.top,t=e?S.right:S.bottom,C=e?S.width:S.height,v=e?x.left:x.top,S=e?x.right:x.bottom,x=e?x.width:x.height,!(_===v||t===S||_+C/2===v+x/2)),_=r?"top":"left",C=Y(l,"top","top")||Y(Z,"top","top"),v=C?C.scrollTop:void 0;if(vt!==l&&(y=D[_],_t=!1,Ct=!S&&s.invertSwap||E),0!==(b=function(t,e,n,o,i,r,a,l){var s=o?t.clientY:t.clientX,c=o?n.height:n.width,t=o?n.top:n.left,o=o?n.bottom:n.right,n=!1;if(!a)if(l&&yt<c*i){if(_t=!_t&&(1===bt?t+c*r/2<s:s<o-c*r/2)?!0:_t)n=!0;else if(1===bt?s<t+yt:o-yt<s)return-bt}else if(t+c*(1-i)/2<s&&s<o-c*(1-i)/2)return function(t){return j(Z)<j(t)?1:-1}(e);if((n=n||a)&&(s<t+c*r/2||o-c*r/2<s))return t+c/2<s?1:-1;return 0}(n,l,D,r,S?1:s.swapThreshold,null==s.invertedSwapThreshold?s.swapThreshold:s.invertedSwapThreshold,Ct,vt===l)))for(var T=j(Z);(w=$.children[T-=b])&&("none"===R(w,"display")||w===Q););if(0===b||w===l)return A(!1);bt=b;var x=(vt=l).nextElementSibling,E=!1,S=Ht(J,a,Z,o,l,D,n,E=1===b);if(!1!==S)return 1!==S&&-1!==S||(E=1===S),xt=!0,setTimeout(Kt,30),M(),E&&!x?a.appendChild(Z):l.parentNode.insertBefore(Z,E?x:l),C&&H(C,0,v-C.scrollTop),$=Z.parentNode,void 0===y||Ct||(yt=Math.abs(y-X(l)[_])),N(),A(!0)}}else{if(m===Z)return A(!1);if((l=m&&a===n.target?m:l)&&(D=X(l)),!1!==Ht(J,a,Z,o,l,D,n,!!l))return M(),m&&m.nextSibling?a.insertBefore(Z,m.nextSibling):a.appendChild(Z),$=a,N(),A(!0)}if(a.contains(Z))return A(!1)}return!1}function O(t,e){U(t,f,I({evt:n,isOwner:d,axis:r?"vertical":"horizontal",revert:i,dragRect:o,targetRect:D,canSort:h,fromSortable:p,target:l,completed:A,onMove:function(t,e){return Ht(J,a,Z,o,t,X(t),n,e)},changed:N},e))}function M(){O("dragOverAnimationCapture"),f.captureAnimationState(),f!==p&&p.captureAnimationState()}function A(t){return O("dragOverCompleted",{insertion:t}),t&&(d?u._hideClone():u._showClone(f),f!==p&&(k(Z,(ct||u).options.ghostClass,!1),k(Z,s.ghostClass,!0)),ct!==f&&f!==jt.active?ct=f:f===jt.active&&ct&&(ct=null),p===f&&(f._ignoreWhileAnimating=l),f.animateAll(function(){O("dragOverAnimationComplete"),f._ignoreWhileAnimating=null}),f!==p&&(p.animateAll(),p._ignoreWhileAnimating=null)),(l===Z&&!Z.animated||l===a&&!l.animated)&&(vt=null),s.dragoverBubble||n.rootEl||l===document||(Z.parentNode[K]._isOutsideThisEl(n.target),t||Bt(n)),!s.dragoverBubble&&n.stopPropagation&&n.stopPropagation(),g=!0}function N(){rt=j(Z),lt=j(Z,s.draggable),V({sortable:f,name:"change",toEl:a,newIndex:rt,newDraggableIndex:lt,originalEvent:n})}},_ignoreWhileAnimating:null,_offMoveEvents:function(){p(document,"mousemove",this._onTouchMove),p(document,"touchmove",this._onTouchMove),p(document,"pointermove",this._onTouchMove),p(document,"dragover",Bt),p(document,"mousemove",Bt),p(document,"touchmove",Bt)},_offUpEvents:function(){var t=this.el.ownerDocument;p(t,"mouseup",this._onDrop),p(t,"touchend",this._onDrop),p(t,"pointerup",this._onDrop),p(t,"pointercancel",this._onDrop),p(t,"touchcancel",this._onDrop),p(document,"selectstart",this)},_onDrop:function(t){var e=this.el,n=this.options;rt=j(Z),lt=j(Z,n.draggable),U("drop",this,{evt:t}),$=Z&&Z.parentNode,rt=j(Z),lt=j(Z,n.draggable),jt.eventCanceled||(_t=Ct=Dt=!1,clearInterval(this._loopId),clearTimeout(this._dragStartTimer),zt(this.cloneId),zt(this._dragStartId),this.nativeDraggable&&(p(document,"drop",this),p(e,"dragstart",this._onDragStart)),this._offMoveEvents(),this._offUpEvents(),u&&R(document.body,"user-select",""),R(Z,"transform",""),t&&(mt&&(t.cancelable&&t.preventDefault(),n.dropBubble||t.stopPropagation()),Q&&Q.parentNode&&Q.parentNode.removeChild(Q),(J===$||ct&&"clone"!==ct.lastPutMode)&&nt&&nt.parentNode&&nt.parentNode.removeChild(nt),Z&&(this.nativeDraggable&&p(Z,"dragend",this),Lt(Z),Z.style["will-change"]="",mt&&!Dt&&k(Z,(ct||this).options.ghostClass,!1),k(Z,this.options.chosenClass,!1),V({sortable:this,name:"unchoose",toEl:$,newIndex:null,newDraggableIndex:null,originalEvent:t}),J!==$?(0<=rt&&(V({rootEl:$,name:"add",toEl:$,fromEl:J,originalEvent:t}),V({sortable:this,name:"remove",toEl:$,originalEvent:t}),V({rootEl:$,name:"sort",toEl:$,fromEl:J,originalEvent:t}),V({sortable:this,name:"sort",toEl:$,originalEvent:t})),ct&&ct.save()):rt!==it&&0<=rt&&(V({sortable:this,name:"update",toEl:$,originalEvent:t}),V({sortable:this,name:"sort",toEl:$,originalEvent:t})),jt.active&&(null!=rt&&-1!==rt||(rt=it,lt=at),V({sortable:this,name:"end",toEl:$,originalEvent:t}),this.save())))),this._nulling()},_nulling:function(){U("nulling",this),J=Z=$=Q=tt=nt=et=ot=ut=dt=mt=rt=lt=it=at=vt=bt=ct=st=jt.dragged=jt.ghost=jt.clone=jt.active=null,Ot.forEach(function(t){t.checked=!0}),Ot.length=ht=pt=0},handleEvent:function(t){switch(t.type){case"drop":case"dragend":this._onDrop(t);break;case"dragenter":case"dragover":Z&&(this._onDragOver(t),function(t){t.dataTransfer&&(t.dataTransfer.dropEffect="move");t.cancelable&&t.preventDefault()}(t));break;case"selectstart":t.preventDefault()}},toArray:function(){for(var t,e=[],n=this.el.children,o=0,i=n.length,r=this.options;o<i;o++)P(t=n[o],r.draggable,this.el,!1)&&e.push(t.getAttribute(r.dataIdAttr)||function(t){var e=t.tagName+t.className+t.src+t.href+t.textContent,n=e.length,o=0;for(;n--;)o+=e.charCodeAt(n);return o.toString(36)}(t));return e},sort:function(t,e){var n={},o=this.el;this.toArray().forEach(function(t,e){e=o.children[e];P(e,this.options.draggable,o,!1)&&(n[t]=e)},this),e&&this.captureAnimationState(),t.forEach(function(t){n[t]&&(o.removeChild(n[t]),o.appendChild(n[t]))}),e&&this.animateAll()},save:function(){var t=this.options.store;t&&t.set&&t.set(this)},closest:function(t,e){return P(t,e||this.options.draggable,this.el,!1)},option:function(t,e){var n=this.options;if(void 0===e)return n[t];var o=z.modifyOption(this,t,e);n[t]=void 0!==o?o:e,"group"===t&&Rt(n)},destroy:function(){U("destroy",this);var t=this.el;t[K]=null,p(t,"mousedown",this._onTapStart),p(t,"touchstart",this._onTapStart),p(t,"pointerdown",this._onTapStart),this.nativeDraggable&&(p(t,"dragover",this),p(t,"dragenter",this)),Array.prototype.forEach.call(t.querySelectorAll("[draggable]"),function(t){t.removeAttribute("draggable")}),this._onDrop(),this._disableDelayedDragEvents(),St.splice(St.indexOf(this.el),1),this.el=t=null},_hideClone:function(){ot||(U("hideClone",this),jt.eventCanceled||(R(nt,"display","none"),this.options.removeCloneOnHide&&nt.parentNode&&nt.parentNode.removeChild(nt),ot=!0))},_showClone:function(t){"clone"===t.lastPutMode?ot&&(U("showClone",this),jt.eventCanceled||(Z.parentNode!=J||this.options.group.revertClone?tt?J.insertBefore(nt,tt):J.appendChild(nt):J.insertBefore(nt,Z),this.options.group.revertClone&&this.animate(Z,nt),R(nt,"display",""),ot=!1)):this._hideClone()}},Mt&&h(document,"touchmove",function(t){(jt.active||Dt)&&t.cancelable&&t.preventDefault()}),jt.utils={on:h,off:p,css:R,find:D,is:function(t,e){return!!P(t,e,t,!1)},extend:function(t,e){if(t&&e)for(var n in e)e.hasOwnProperty(n)&&(t[n]=e[n]);return t},throttle:_,closest:P,toggleClass:k,clone:C,index:j,nextTick:Wt,cancelNextTick:zt,detectDirection:kt,getChild:B,expando:K},jt.get=function(t){return t[K]},jt.mount=function(){for(var t=arguments.length,e=new Array(t),n=0;n<t;n++)e[n]=arguments[n];(e=e[0].constructor===Array?e[0]:e).forEach(function(t){if(!t.prototype||!t.prototype.constructor)throw"Sortable: Mounted plugin must be a constructor function, not ".concat({}.toString.call(t));t.utils&&(jt.utils=I(I({},jt.utils),t.utils)),z.mount(t)})},jt.create=function(t,e){return new jt(t,e)};var Gt,Ut,qt,Vt,Zt,$t,Qt=[],Jt=!(jt.version="1.15.6");function te(){Qt.forEach(function(t){clearInterval(t.pid)}),Qt=[]}function ee(){clearInterval($t)}var ne,oe=_(function(n,t,e,o){if(t.scroll){var i,r=(n.touches?n.touches[0]:n).clientX,a=(n.touches?n.touches[0]:n).clientY,l=t.scrollSensitivity,s=t.scrollSpeed,c=O(),u=!1;Ut!==e&&(Ut=e,te(),Gt=t.scroll,i=t.scrollFn,!0===Gt&&(Gt=M(e,!0)));var d=0,h=Gt;do{var p=h,f=X(p),g=f.top,m=f.bottom,v=f.left,b=f.right,y=f.width,w=f.height,D=void 0,E=void 0,S=p.scrollWidth,_=p.scrollHeight,C=R(p),T=p.scrollLeft,f=p.scrollTop,E=p===c?(D=y<S&&("auto"===C.overflowX||"scroll"===C.overflowX||"visible"===C.overflowX),w<_&&("auto"===C.overflowY||"scroll"===C.overflowY||"visible"===C.overflowY)):(D=y<S&&("auto"===C.overflowX||"scroll"===C.overflowX),w<_&&("auto"===C.overflowY||"scroll"===C.overflowY)),T=D&&(Math.abs(b-r)<=l&&T+y<S)-(Math.abs(v-r)<=l&&!!T),f=E&&(Math.abs(m-a)<=l&&f+w<_)-(Math.abs(g-a)<=l&&!!f);if(!Qt[d])for(var x=0;x<=d;x++)Qt[x]||(Qt[x]={});Qt[d].vx==T&&Qt[d].vy==f&&Qt[d].el===p||(Qt[d].el=p,Qt[d].vx=T,Qt[d].vy=f,clearInterval(Qt[d].pid),0==T&&0==f||(u=!0,Qt[d].pid=setInterval(function(){o&&0===this.layer&&jt.active._onTouchMove(Zt);var t=Qt[this.layer].vy?Qt[this.layer].vy*s:0,e=Qt[this.layer].vx?Qt[this.layer].vx*s:0;"function"==typeof i&&"continue"!==i.call(jt.dragged.parentNode[K],e,t,n,Zt,Qt[this.layer].el)||H(Qt[this.layer].el,e,t)}.bind({layer:d}),24))),d++}while(t.bubbleScroll&&h!==c&&(h=M(h,!1)));Jt=u}},30),n=function(t){var e=t.originalEvent,n=t.putSortable,o=t.dragEl,i=t.activeSortable,r=t.dispatchSortableEvent,a=t.hideGhostForTarget,t=t.unhideGhostForTarget;e&&(i=n||i,a(),e=e.changedTouches&&e.changedTouches.length?e.changedTouches[0]:e,e=document.elementFromPoint(e.clientX,e.clientY),t(),i&&!i.el.contains(e)&&(r("spill"),this.onSpill({dragEl:o,putSortable:n})))};function ie(){}function re(){}ie.prototype={startIndex:null,dragStart:function(t){t=t.oldDraggableIndex;this.startIndex=t},onSpill:function(t){var e=t.dragEl,n=t.putSortable;this.sortable.captureAnimationState(),n&&n.captureAnimationState();t=B(this.sortable.el,this.startIndex,this.options);t?this.sortable.el.insertBefore(e,t):this.sortable.el.appendChild(e),this.sortable.animateAll(),n&&n.animateAll()},drop:n},a(ie,{pluginName:"revertOnSpill"}),re.prototype={onSpill:function(t){var e=t.dragEl,t=t.putSortable||this.sortable;t.captureAnimationState(),e.parentNode&&e.parentNode.removeChild(e),t.animateAll()},drop:n},a(re,{pluginName:"removeOnSpill"});var ae,le,se,ce,ue,de=[],he=[],pe=!1,fe=!1,ge=!1;function me(n,o){he.forEach(function(t,e){e=o.children[t.sortableIndex+(n?Number(e):0)];e?o.insertBefore(t,e):o.appendChild(t)})}function ve(){de.forEach(function(t){t!==se&&t.parentNode&&t.parentNode.removeChild(t)})}return jt.mount(new function(){function t(){for(var t in this.defaults={scroll:!0,forceAutoScrollFallback:!1,scrollSensitivity:30,scrollSpeed:10,bubbleScroll:!0},this)"_"===t.charAt(0)&&"function"==typeof this[t]&&(this[t]=this[t].bind(this))}return t.prototype={dragStarted:function(t){t=t.originalEvent;this.sortable.nativeDraggable?h(document,"dragover",this._handleAutoScroll):this.options.supportPointer?h(document,"pointermove",this._handleFallbackAutoScroll):t.touches?h(document,"touchmove",this._handleFallbackAutoScroll):h(document,"mousemove",this._handleFallbackAutoScroll)},dragOverCompleted:function(t){t=t.originalEvent;this.options.dragOverBubble||t.rootEl||this._handleAutoScroll(t)},drop:function(){this.sortable.nativeDraggable?p(document,"dragover",this._handleAutoScroll):(p(document,"pointermove",this._handleFallbackAutoScroll),p(document,"touchmove",this._handleFallbackAutoScroll),p(document,"mousemove",this._handleFallbackAutoScroll)),ee(),te(),clearTimeout(m),m=void 0},nulling:function(){Zt=Ut=Gt=Jt=$t=qt=Vt=null,Qt.length=0},_handleFallbackAutoScroll:function(t){this._handleAutoScroll(t,!0)},_handleAutoScroll:function(e,n){var o,i=this,r=(e.touches?e.touches[0]:e).clientX,a=(e.touches?e.touches[0]:e).clientY,t=document.elementFromPoint(r,a);Zt=e,n||this.options.forceAutoScrollFallback||w||y||u?(oe(e,this.options,t,n),o=M(t,!0),!Jt||$t&&r===qt&&a===Vt||($t&&ee(),$t=setInterval(function(){var t=M(document.elementFromPoint(r,a),!0);t!==o&&(o=t,te()),oe(e,i.options,t,n)},10),qt=r,Vt=a)):this.options.bubbleScroll&&M(t,!0)!==O()?oe(e,this.options,M(t,!1),!1):te()}},a(t,{pluginName:"scroll",initializeByDefault:!0})}),jt.mount(re,ie),jt.mount(new function(){function t(){this.defaults={swapClass:"sortable-swap-highlight"}}return t.prototype={dragStart:function(t){t=t.dragEl;ne=t},dragOverValid:function(t){var e=t.completed,n=t.target,o=t.onMove,i=t.activeSortable,r=t.changed,a=t.cancel;i.options.swap&&(t=this.sortable.el,i=this.options,n&&n!==t&&(t=ne,ne=!1!==o(n)?(k(n,i.swapClass,!0),n):null,t&&t!==ne&&k(t,i.swapClass,!1)),r(),e(!0),a())},drop:function(t){var e,n,o=t.activeSortable,i=t.putSortable,r=t.dragEl,a=i||this.sortable,l=this.options;ne&&k(ne,l.swapClass,!1),ne&&(l.swap||i&&i.options.swap)&&r!==ne&&(a.captureAnimationState(),a!==o&&o.captureAnimationState(),n=ne,t=(e=r).parentNode,l=n.parentNode,t&&l&&!t.isEqualNode(n)&&!l.isEqualNode(e)&&(i=j(e),r=j(n),t.isEqualNode(l)&&i<r&&r++,t.insertBefore(n,t.children[i]),l.insertBefore(e,l.children[r])),a.animateAll(),a!==o&&o.animateAll())},nulling:function(){ne=null}},a(t,{pluginName:"swap",eventProperties:function(){return{swapItem:ne}}})}),jt.mount(new function(){function t(o){for(var t in this)"_"===t.charAt(0)&&"function"==typeof this[t]&&(this[t]=this[t].bind(this));o.options.avoidImplicitDeselect||(o.options.supportPointer?h(document,"pointerup",this._deselectMultiDrag):(h(document,"mouseup",this._deselectMultiDrag),h(document,"touchend",this._deselectMultiDrag))),h(document,"keydown",this._checkKeyDown),h(document,"keyup",this._checkKeyUp),this.defaults={selectedClass:"sortable-selected",multiDragKey:null,avoidImplicitDeselect:!1,setData:function(t,e){var n="";de.length&&le===o?de.forEach(function(t,e){n+=(e?", ":"")+t.textContent}):n=e.textContent,t.setData("Text",n)}}}return t.prototype={multiDragKeyDown:!1,isMultiDrag:!1,delayStartGlobal:function(t){t=t.dragEl;se=t},delayEnded:function(){this.isMultiDrag=~de.indexOf(se)},setupClone:function(t){var e=t.sortable,t=t.cancel;if(this.isMultiDrag){for(var n=0;n<de.length;n++)he.push(C(de[n])),he[n].sortableIndex=de[n].sortableIndex,he[n].draggable=!1,he[n].style["will-change"]="",k(he[n],this.options.selectedClass,!1),de[n]===se&&k(he[n],this.options.chosenClass,!1);e._hideClone(),t()}},clone:function(t){var e=t.sortable,n=t.rootEl,o=t.dispatchSortableEvent,t=t.cancel;this.isMultiDrag&&(this.options.removeCloneOnHide||de.length&&le===e&&(me(!0,n),o("clone"),t()))},showClone:function(t){var e=t.cloneNowShown,n=t.rootEl,t=t.cancel;this.isMultiDrag&&(me(!1,n),he.forEach(function(t){R(t,"display","")}),e(),ue=!1,t())},hideClone:function(t){var e=this,n=(t.sortable,t.cloneNowHidden),t=t.cancel;this.isMultiDrag&&(he.forEach(function(t){R(t,"display","none"),e.options.removeCloneOnHide&&t.parentNode&&t.parentNode.removeChild(t)}),n(),ue=!0,t())},dragStartGlobal:function(t){t.sortable;!this.isMultiDrag&&le&&le.multiDrag._deselectMultiDrag(),de.forEach(function(t){t.sortableIndex=j(t)}),de=de.sort(function(t,e){return t.sortableIndex-e.sortableIndex}),ge=!0},dragStarted:function(t){var e,n=this,t=t.sortable;this.isMultiDrag&&(this.options.sort&&(t.captureAnimationState(),this.options.animation&&(de.forEach(function(t){t!==se&&R(t,"position","absolute")}),e=X(se,!1,!0,!0),de.forEach(function(t){t!==se&&T(t,e)}),pe=fe=!0)),t.animateAll(function(){pe=fe=!1,n.options.animation&&de.forEach(function(t){x(t)}),n.options.sort&&ve()}))},dragOver:function(t){var e=t.target,n=t.completed,t=t.cancel;fe&&~de.indexOf(e)&&(n(!1),t())},revert:function(t){var n,o,e=t.fromSortable,i=t.rootEl,r=t.sortable,a=t.dragRect;1<de.length&&(de.forEach(function(t){r.addAnimationState({target:t,rect:fe?X(t):a}),x(t),t.fromRect=a,e.removeAnimationState(t)}),fe=!1,n=!this.options.removeCloneOnHide,o=i,de.forEach(function(t,e){e=o.children[t.sortableIndex+(n?Number(e):0)];e?o.insertBefore(t,e):o.appendChild(t)}))},dragOverCompleted:function(t){var e,n=t.sortable,o=t.isOwner,i=t.insertion,r=t.activeSortable,a=t.parentEl,l=t.putSortable,t=this.options;i&&(o&&r._hideClone(),pe=!1,t.animation&&1<de.length&&(fe||!o&&!r.options.sort&&!l)&&(e=X(se,!1,!0,!0),de.forEach(function(t){t!==se&&(T(t,e),a.appendChild(t))}),fe=!0),o||(fe||ve(),1<de.length?(o=ue,r._showClone(n),r.options.animation&&!ue&&o&&he.forEach(function(t){r.addAnimationState({target:t,rect:ce}),t.fromRect=ce,t.thisAnimationDuration=null})):r._showClone(n)))},dragOverAnimationCapture:function(t){var e=t.dragRect,n=t.isOwner,t=t.activeSortable;de.forEach(function(t){t.thisAnimationDuration=null}),t.options.animation&&!n&&t.multiDrag.isMultiDrag&&(ce=a({},e),e=b(se,!0),ce.top-=e.f,ce.left-=e.e)},dragOverAnimationComplete:function(){fe&&(fe=!1,ve())},drop:function(t){var o,i,r,a,n,e,l,s=t.originalEvent,c=t.rootEl,u=t.parentEl,d=t.sortable,h=t.dispatchSortableEvent,p=t.oldIndex,t=t.putSortable,f=t||this.sortable;s&&(o=this.options,i=u.children,ge||(o.multiDragKey&&!this.multiDragKeyDown&&this._deselectMultiDrag(),k(se,o.selectedClass,!~de.indexOf(se)),~de.indexOf(se)?(de.splice(de.indexOf(se),1),ae=null,G({sortable:d,rootEl:c,name:"deselect",targetEl:se,originalEvent:s})):(de.push(se),G({sortable:d,rootEl:c,name:"select",targetEl:se,originalEvent:s}),s.shiftKey&&ae&&d.el.contains(ae)?(r=j(ae),a=j(se),~r&&~a&&r!==a&&function(){for(var e,t=r<a?(e=r,a):(e=a,r+1),n=o.filter;e<t;e++)~de.indexOf(i[e])||P(i[e],o.draggable,u,!1)&&(n&&("function"==typeof n?n.call(d,s,i[e],d):n.split(",").some(function(t){return P(i[e],t.trim(),u,!1)}))||(k(i[e],o.selectedClass,!0),de.push(i[e]),G({sortable:d,rootEl:c,name:"select",targetEl:i[e],originalEvent:s})))}()):ae=se,le=f)),ge&&this.isMultiDrag&&(fe=!1,(u[K].options.sort||u!==c)&&1<de.length&&(n=X(se),e=j(se,":not(."+this.options.selectedClass+")"),!pe&&o.animation&&(se.thisAnimationDuration=null),f.captureAnimationState(),pe||(o.animation&&(se.fromRect=n,de.forEach(function(t){var e;t.thisAnimationDuration=null,t!==se&&(e=fe?X(t):n,t.fromRect=e,f.addAnimationState({target:t,rect:e}))})),ve(),de.forEach(function(t){i[e]?u.insertBefore(t,i[e]):u.appendChild(t),e++}),p===j(se)&&(l=!1,de.forEach(function(t){t.sortableIndex!==j(t)&&(l=!0)}),l&&(h("update"),h("sort")))),de.forEach(function(t){x(t)}),f.animateAll()),le=f),(c===u||t&&"clone"!==t.lastPutMode)&&he.forEach(function(t){t.parentNode&&t.parentNode.removeChild(t)}))},nullingGlobal:function(){this.isMultiDrag=ge=!1,he.length=0},destroyGlobal:function(){this._deselectMultiDrag(),p(document,"pointerup",this._deselectMultiDrag),p(document,"mouseup",this._deselectMultiDrag),p(document,"touchend",this._deselectMultiDrag),p(document,"keydown",this._checkKeyDown),p(document,"keyup",this._checkKeyUp)},_deselectMultiDrag:function(t){if(!(void 0!==ge&&ge||le!==this.sortable||t&&P(t.target,this.options.draggable,this.sortable.el,!1)||t&&0!==t.button))for(;de.length;){var e=de[0];k(e,this.options.selectedClass,!1),de.shift(),G({sortable:this.sortable,rootEl:this.sortable.el,name:"deselect",targetEl:e,originalEvent:t})}},_checkKeyDown:function(t){t.key===this.options.multiDragKey&&(this.multiDragKeyDown=!0)},_checkKeyUp:function(t){t.key===this.options.multiDragKey&&(this.multiDragKeyDown=!1)}},a(t,{pluginName:"multiDrag",utils:{select:function(t){var e=t.parentNode[K];e&&e.options.multiDrag&&!~de.indexOf(t)&&(le&&le!==e&&(le.multiDrag._deselectMultiDrag(),le=e),k(t,e.options.selectedClass,!0),de.push(t))},deselect:function(t){var e=t.parentNode[K],n=de.indexOf(t);e&&e.options.multiDrag&&~n&&(k(t,e.options.selectedClass,!1),de.splice(n,1))}},eventProperties:function(){var n=this,o=[],i=[];return de.forEach(function(t){var e;o.push({multiDragElement:t,index:t.sortableIndex}),e=fe&&t!==se?-1:fe?j(t,":not(."+n.options.selectedClass+")"):j(t),i.push({multiDragElement:t,index:e})}),{items:r(de),clones:[].concat(he),oldIndicies:o,newIndicies:i}},optionListeners:{multiDragKey:function(t){return"ctrl"===(t=t.toLowerCase())?t="Control":1<t.length&&(t=t.charAt(0).toUpperCase()+t.substr(1)),t}}})}),jt});
  return module.exports;
})();

/* marktile — the tile-family standalone editor. Opens any .md note in the SAME world-class editor as
   tugtile (headings grow while the '## ' markers stay; CJK-safe contenteditable; smart-Enter lists).
   It is a switchable pane: the leaf becomes marktile, with a header button back to Obsidian's editor — and
   Obsidian's editor gets a button over to marktile. No global hijack (registerExtensions), so the native
   editor is always one tap away and a bug can never lock you out of a note.
   Built by build-marktile.sh, which (1) injects i18n into the TR object below and (2) inlines the shared
   core blocks (marked core-start / core-end in ../plugin.src.js) at the core-inline line. */
const { Plugin, Notice, TextFileView, Modal, setIcon, Platform, PluginSettingTab, Setting } = require('obsidian');   // Modal/setIcon/Platform are used by the inlined core editor; PluginSettingTab/Setting for the settings tab

// ---- i18n (mirrors tugtile; the same i18n/*.json is injected at build) ----
const LOCALE = (() => {
  let lang = '';
  try { lang = (window.localStorage.getItem('language') || ''); } catch (e) { lang = ''; }
  if (lang === 'zh-TW') return 'zh-TW';
  if (lang === 'ja') return 'ja-JP';
  if (lang === 'ko') return 'ko-KR';
  return 'en-US';
})();
const TR = {"en-US": {"appName": "tugtile", "brandSuffix": "tugtile-ing", "brandSuffixLocked": "tugtile", "lockToggle": "Lock / unlock board", "lockedNotice": "Board is locked", "undoAction": "Undo", "redoAction": "Redo", "viewSwitchAction": "Switch view (Board / Table)", "boardSettingsAction": "Board settings", "openAsMarkdownAction": "Open as markdown", "archiveAction": "Stash (Archive)", "searchAction": "Search tiles", "emptyNoFile": "Open a board .md with the “Open as tugtile” command.", "fileNotFound": "File not found: {0}", "searchPlaceholder": "Find a tile", "viewBoard": "Board", "viewTable": "Table", "editMarkdown": "Edit raw markdown", "findPlaceholder": "Find", "replacePlaceholder": "Replace", "findPrev": "Previous", "findNext": "Next", "replaceOne": "Replace", "replaceAll": "Replace all", "colTile": "Tile", "colLane": "Lane", "colDate": "Date", "colTags": "Tags", "collapseExpand": "Collapse / expand", "laneActionsAria": "Lane actions (rename / insert / sort / stash / delete…)", "tileActionsAria": "More actions (edit / stash / delete…)", "relDateWrap": " ({0})", "today": "today", "tomorrow": "tomorrow", "yesterday": "yesterday", "dayAfterTomorrow": "in 2 days", "dayBeforeYesterday": "2 days ago", "daysLater": "in {0} days", "daysAgo": "{0} days ago", "yearMonth": "{0}-{1}", "weekdays": ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"], "edit": "Edit", "duplicateTile": "Duplicate", "insertTileAbove": "Insert tile above", "insertTileBelow": "Insert tile below", "splitTileMenu": "Split into tiles", "archiveTileMenu": "Stash (Archive)", "moveTileTop": "Move to top", "moveTileBottom": "Move to bottom", "untitledLane": "(untitled)", "moveToLane": "Move to “{0}”", "deleteTileMenu": "Delete", "splitNoNeed": "Only one line — nothing to split.", "splitDone": "Split into {0} tiles", "archivedTile": "Tile stashed", "deletedTile": "Tile deleted", "deletedLane": "Lane deleted", "toastUndoBtn": "Undo", "addTileBtn": "＋ Add a tile", "dropToArchive": "Drop here to stash", "cancel": "Cancel", "save": "Save", "discardConfirm": "Discard your changes?", "editLost": "Tile no longer exists — edit not saved.", "mobileSubmit": "Submit", "addLaneBtn": "＋ Add lane", "addLanePlaceholder": "Lane name — ⏎ to add", "newLane": "New lane", "newBoardName": "New board", "confirmDeleteLane": "This lane has {0} tiles. Delete the whole lane?", "boardListViewOnly": "Use this in Board view", "archivedCompleted": "Stashed {0} completed tiles", "noCompleted": "No completed tiles", "rename": "Rename", "insertLaneBefore": "Insert lane before", "insertLaneAfter": "Insert lane after", "sortTitleAsc": "Sort by tile title A→Z", "sortTitleDesc": "Sort by tile title Z→A", "sortDate": "Sort by date (soonest first)", "sortTag": "Sort by tag", "markLaneComplete": "Mark all in lane complete", "archiveLaneMenu": "Stash all tiles in lane", "deleteLaneMenu": "Delete lane", "confirmArchiveLane": "Stash all {0} tiles in this lane?", "archivedLane": "Stashed {0} tiles from lane", "noLaneToRestore": "tugtile: no lane to restore into — create a lane first", "externalModified": "tugtile: this file was changed elsewhere — reloaded to avoid overwrite (this step was not saved)", "backupFailed": "tugtile: backup failed — write cancelled to protect your data", "writeFailed": "tugtile write failed: {0}", "saved": "Saved", "persistFailed": "tugtile: save failed — {0}", "undoVerb": "undo", "redoVerb": "redo", "noStep": "tugtile: nothing left to {0}", "timeTraveled": "tugtile: {0} done (undo {1} / redo {2})", "archiveTitle": "Stash (Archive)", "archiveEmpty": "No stashed tiles.", "restore": "Restore", "deleteArchived": "Delete", "boardSettingsTitle": "Board settings", "boardSettingsDesc": "Affects only this board (saved with the board file). Blank = follow the global default.", "migrateBtn": "Upgrade to tugtile format", "migrateBtnDesc": "Remove obsidian-kanban markers so this board is tugtile-native. One-way.", "migrateConfirm": "Upgrade this board to tugtile’s own format? It will no longer open in obsidian-kanban, and kanban-only settings will be dropped.", "migrateDone": "Upgraded to tugtile format", "confirm": "Confirm", "setShowCheckboxes": "Show tile checkbox", "setHideCount": "Hide lane count", "setEnterBehavior": "Enter key behavior", "setEnterBehaviorDesc": "shift-enter = Enter submits (CJK friendly); enter = Enter newline", "optEnterSubmit": "Enter submits", "optEnterNewline": "Enter newline", "setNewCardPos": "New tile position", "optAppend": "At lane bottom", "optPrepend": "At lane top", "optPrependCompact": "At lane top (compact)", "setRelativeDate": "Show relative date", "setRelativeDateDesc": "today / tomorrow / in N days", "setDateFormat": "Date storage format", "setDateFormatDesc": "Format written into markdown (e.g. YYYY-MM-DD)", "setDateDisplay": "Date display format", "setDateDisplayDesc": "Format shown on tiles", "setDateTrigger": "Date trigger char", "setDateTriggerDesc": "Default @", "setTimeTrigger": "Time trigger char", "setTimeTriggerDesc": "Default @@", "setLinkDaily": "Link date to daily note", "setLinkDailyDesc": "Write date as @[[..]] linking to the daily note", "setTagAction": "Tag click action", "setTagActionDesc": "What clicking a tag does — search the whole vault, or filter just this board.", "optSearchVault": "Search whole vault", "optFilterBoard": "Filter this board", "setMoveTags": "Move tags to tile footer", "setArchiveWithDate": "Add timestamp on stash", "settingsTitle": "tugtile settings", "settingsDesc": "These are global defaults; a board’s own settings of the same name take precedence.", "gShowCheckboxes": "Show tile checkbox", "gShowCheckboxesDesc": "Show a checkbox at the top-right of each tile (toggles - [ ] / - [x])", "gHideCount": "Hide lane count", "gHideCountDesc": "Don’t show the tile count in the lane header", "gResponsiveBoard": "Responsive board (stack on narrow panes)", "gResponsiveBoardDesc": "On a narrow pane, the board reflows into a single vertical stack.", "gLaneWidth": "Lane width", "gLaneWidthDesc": "Width of every lane — all lanes line up evenly", "gTableDensity": "Table row spacing", "gTableDensityDesc": "Vertical breathing room for each table row", "gFormatTools": "Text formatting buttons", "gFormatToolsDesc": "Headings, bold, italic, strikethrough.", "gInsertTools": "Insert buttons", "gInsertToolsDesc": "Which insert buttons show (code, link, date, time)", "optDenseTight": "Tight", "optDenseMid": "Medium", "optDenseLoose": "Loose", "gEnterSubmit": "Enter submits", "gEnterSubmitDesc": "On: Enter submits, Shift+Enter newline (CJK-friendly default). Off: Enter newline, Shift/⌘+Enter submits", "gPrepend": "Add new tile at top", "gPrependDesc": "Default adds at the bottom; enable to add at the top", "gRelativeDate": "Show relative date", "gRelativeDateDesc": "Show “today / tomorrow / in N days” on tile dates", "gDateDisplay": "Date display format", "gDateDisplayDesc": "moment-style tokens: YYYY / MM / DD (default YYYY-MM-DD)", "gArchiveWithDate": "Add timestamp on stash", "gArchiveWithDateDesc": "Prepend **YYYY-MM-DD HH:mm** to the title when stashing", "gArchiveHeading": "Stash heading", "gArchiveHeadingDesc": "Heading text for a new stash (archive) section (e.g. Archive, 封存).", "gDanger": "Danger zone", "gReset": "Reset to defaults", "gResetDesc": "Restore the above global settings to defaults", "gResetBtn": "Reset", "cmdToggleView": "tugtile: toggle board / markdown", "cmdOpenAsBoard": "Open as tugtile", "cmdUndo": "tugtile: undo", "cmdRedo": "tugtile: redo", "cmdCreateBoard": "tugtile: create new board", "cmdSearch": "tugtile: search tiles (bindable to Cmd/Ctrl+F)", "cmdArchiveCompleted": "tugtile: stash all completed tiles", "cmdConvertToBoard": "tugtile: convert current note to board", "cmdNewCard": "tugtile: new tile in lane", "cmdNewLane": "tugtile: new lane", "cmdRenameLane": "tugtile: rename lane", "createBoardHere": "Create tugtile board here", "openAsBoard": "Open as tugtile board", "ribbonTitle": "tugtile board", "ribbonNoFile": "Open a board .md first", "convertFailed": "tugtile convert failed: {0}", "boardCreated": "Board created: {0} (rename it in the file explorer)", "createBoardFailed": "tugtile create board failed: {0}", "mtRibbon": "Edit in marktile", "mtOpenCmd": "marktile: edit current note", "mtNoFile": "Open a .md note first", "mtBackToObsidian": "Back to Obsidian editor", "openInMarktile": "Open in marktile", "mtToTugtile": "Open as tugtile board", "mtBrand": "marktile-ing", "mtBrandLocked": "marktile", "mtEssentialTools": "Essential buttons", "mtEssentialToolsDesc": "Search, undo, redo", "mtInsertToolsDesc": "Which insert buttons to show (code / link)", "mtDefaultEditor": "Make marktile the default Markdown editor", "mtDefaultEditorDesc": "Off by default. When on, .md files open in marktile instead of Obsidian's editor (board files too — hop to tugtile with its button). Reload Obsidian to apply; turn off anytime to restore the native editor.", "mtReloadRequired": "Reload Obsidian to apply", "mtSettings": "marktile settings", "mtSettingsTitle": "marktile settings", "mtSettingsDesc": "marktile opens any .md note in the tile-family editor. Choose which toolbar buttons appear (uncheck all to hide the toolbar entirely), or make marktile your default Markdown editor.", "mtModePlain": "Plain", "mtModeSeasoned": "Seasoned", "expandAllAction": "Expand all", "collapseAllAction": "Collapse all", "expandLanesAction": "Expand lanes", "mtModeToggle": "Toggle Seasoned / Plain", "mtLockToggle": "Lock editor (read-only)", "mtToc": "Table of contents", "mtTocEmpty": "No headings", "edH1": "Heading 1", "edH2": "Heading 2", "edH3": "Heading 3", "edBold": "Bold", "edItalic": "Italic", "edStrike": "Strikethrough", "edClear": "Clear formatting", "edBullet": "Bullet list", "edNumber": "Numbered list", "edCheck": "Checklist", "edQuote": "Blockquote", "edCode": "Inline code", "edLink": "Wikilink", "edDate": "Insert date", "edTime": "Insert time", "edFind": "Find / replace", "TBL_INS_COL_L": "Insert column left", "TBL_INS_COL_R": "Insert column right", "TBL_INS_ROW_A": "Insert row above", "TBL_INS_ROW_B": "Insert row below", "TBL_DEL_COL": "Delete column", "TBL_DEL_ROW": "Delete row", "TBL_MOV_COL_L": "Move column left", "TBL_MOV_COL_R": "Move column right", "TBL_MOV_ROW_U": "Move row up", "TBL_MOV_ROW_D": "Move row down", "TBL_SORT_ASC": "Sort by this column (ascending)", "TBL_SORT_DESC": "Sort by this column (descending)", "TBL_ALIGN": "Align table source", "mtModeRendered": "Rendered", "mtModesPick": "View modes", "mtModesPickDesc": "Which modes the view-cycle button rotates through. At least one stays on.", "mtModesMinOne": "Keep at least one view mode.", "gBlockTools": "Block tools", "gBlockToolsDesc": "Lists, checklist, quote, table.", "edTable": "Table", "edImage": "Insert image", "edVideo": "Insert video", "edVideoPrompt": "Video URL (YouTube / Vimeo / mp4):", "mtSeasonedColor": "Seasoned: colorful syntax", "mtSeasonedColorDesc": "Color each markdown token (headings, bold, code, links) with its own hue instead of a single accent tint.", "backupsAction": "Backups", "backupTitle": "Board backups", "backupDesc": "tugtile snapshots this board to _tugtile-backups/ before the first change each session, and reloads if the file is edited elsewhere — a bad edit or a sync clash never loses your work.", "backupEmpty": "No backups yet — one is made automatically before this board's first change each session.", "backupOpen": "Open", "backupRestoreConfirm": "Replace the current board with this backup? Your current state is backed up first, so this is reversible.", "backupRestored": "tugtile: board restored from backup", "backupRestoreFailed": "tugtile: couldn't restore this backup", "safetyHeading": "Your data is safe", "backupRetentionName": "Backup history limit", "backupRetentionDesc": "How many backups to keep per board; the oldest are removed beyond this (-1 keeps all).", "familyMarktile": "marktile — the companion editor", "familyMarktileDesc": "A Markdown editor where the markers never hide and headings grow — same engine, same feel as the card editor here.", "familyTugtile": "tugtile — the companion board", "familyTugtileDesc": "Turn your Markdown notes into a card board you can tug to reorder. Reads your existing boards.", "familyGet": "View plugin", "familyHave": "You already have the full tile family.", "keyboardHintName": "Keyboard", "keyboardHint": "Tip: focus a card (Tab or click), then use the arrow keys to move it — up/down within a lane, left/right across lanes.", "searchAll": "Search every document", "searchAllPlaceholder": "Search every document", "searchAllHint": "Every Markdown file on this Mac. Type a word you remember.", "searchAllNone": "Nothing. Try one word, or a different guess.", "searchAllStat": "{0} files · {1} shown", "searchAllOffline": "{0} more in the cloud, not downloaded", "searchAllCapped": "read the {0} newest of {1}"}, "ja-JP": {"appName": "タッグタイル", "brandSuffix": "tugtile-ing（タッグタイル中）", "brandSuffixLocked": "tugtile（タッグタイル）", "lockToggle": "ボードをロック／解除", "lockedNotice": "ボードはロックされています", "undoAction": "待った", "redoAction": "やり直し", "viewSwitchAction": "ビュー切替（ボード／表）", "boardSettingsAction": "このボードの設定", "openAsMarkdownAction": "Markdown で開く", "archiveAction": "アーカイブ", "searchAction": "タイルを検索", "emptyNoFile": "ボードの .md でコマンド「tugtile で開く」を使ってください。", "fileNotFound": "ファイルが見つかりません：{0}", "searchPlaceholder": "タイルを探す", "viewBoard": "ボード", "viewTable": "表", "editMarkdown": "Markdown を直接編集", "findPlaceholder": "検索", "replacePlaceholder": "置換後", "findPrev": "前へ", "findNext": "次へ", "replaceOne": "置換", "replaceAll": "すべて置換", "colTile": "タイル", "colLane": "列", "colDate": "日付", "colTags": "タグ", "collapseExpand": "折りたたみ / 展開", "laneActionsAria": "列の操作（名前変更／挿入／並べ替え／アーカイブ／削除…）", "tileActionsAria": "その他の操作（編集／アーカイブ／削除…）", "relDateWrap": "（{0}）", "today": "今日", "tomorrow": "明日", "yesterday": "昨日", "dayAfterTomorrow": "明後日", "dayBeforeYesterday": "一昨日", "daysLater": "{0} 日後", "daysAgo": "{0} 日前", "yearMonth": "{0}年 {1}月", "weekdays": ["日", "月", "火", "水", "木", "金", "土"], "edit": "編集", "duplicateTile": "タイルを複製", "insertTileAbove": "上にタイルを挿入", "insertTileBelow": "下にタイルを挿入", "splitTileMenu": "分割", "archiveTileMenu": "アーカイブ", "moveTileTop": "列の先頭へ", "moveTileBottom": "列の末尾へ", "untitledLane": "(無題)", "moveToLane": "「{0}」へ移動", "deleteTileMenu": "タイルを捨てる", "splitNoNeed": "1行のみ。分割は不要です。", "splitDone": "{0} 枚のタイルに分割しました", "archivedTile": "タイルをアーカイブしました", "deletedTile": "タイルを捨てました", "deletedLane": "列を削除しました", "toastUndoBtn": "待った", "addTileBtn": "＋ タイルを追加", "dropToArchive": "ここにドロップでアーカイブ", "cancel": "キャンセル", "save": "保存", "discardConfirm": "変更を破棄しますか？", "editLost": "このタイルは存在しません。編集は保存されませんでした。", "mobileSubmit": "送信", "addLaneBtn": "＋ 列を追加", "addLanePlaceholder": "列名　⏎ で追加", "newLane": "新しい列", "newBoardName": "新しいボード", "confirmDeleteLane": "この列には {0} 枚のタイルがあります。列ごと削除しますか？", "boardListViewOnly": "ボードビューで使ってください", "archivedCompleted": "完了したタイル {0} 枚をアーカイブしました", "noCompleted": "完了したタイルはありません", "rename": "名前を変更", "insertLaneBefore": "前に列を挿入", "insertLaneAfter": "後に列を挿入", "sortTitleAsc": "タイトルで並べ替え A→Z", "sortTitleDesc": "タイトルで並べ替え Z→A", "sortDate": "日付で並べ替え（近い順）", "sortTag": "タグで並べ替え", "markLaneComplete": "この列をすべて完了にする", "archiveLaneMenu": "この列のタイルをすべてアーカイブ", "deleteLaneMenu": "列を削除", "confirmArchiveLane": "この列の {0} 枚のタイルをすべてアーカイブしますか？", "archivedLane": "この列のタイル {0} 枚をアーカイブしました", "noLaneToRestore": "tugtile：戻せる列がありません。先に列を作成してください", "externalModified": "tugtile：このファイルが別の場所で変更されました。上書きを避けるため再読み込みしました（この操作は保存されていません）", "backupFailed": "tugtile：バックアップに失敗したため、データ保護のため書き込みを中止しました", "writeFailed": "tugtile 書き込み失敗：{0}", "saved": "保存しました", "persistFailed": "tugtile：保存に失敗しました、{0}", "undoVerb": "待った", "redoVerb": "やり直し", "noStep": "tugtile：{0}できる操作がありません", "timeTraveled": "tugtile：{0}しました（待った {1} / やり直し {2}）", "archiveTitle": "アーカイブ", "archiveEmpty": "アーカイブされたタイルはありません。", "restore": "戻す", "deleteArchived": "タイルを捨てる", "boardSettingsTitle": "このボードの設定", "boardSettingsDesc": "このボードだけを変更します（ボードのファイルに保存）。空白＝グローバル既定に従う。", "migrateBtn": "tugtile 形式にアップグレード", "migrateBtnDesc": "obsidian-kanban のマーカーを除去し、このボードを tugtile ネイティブにします。一方向。", "migrateConfirm": "このボードを tugtile 独自の形式にアップグレードしますか？以後 obsidian-kanban では開けなくなり、kanban 専用の設定は削除されます。", "migrateDone": "tugtile 形式にアップグレードしました", "confirm": "確定", "setShowCheckboxes": "タイルのチェックボックスを表示", "setHideCount": "列のカウントを隠す", "setEnterBehavior": "Enter キーの動作", "setEnterBehaviorDesc": "shift-enter＝Enter で送信（CJK 向け）；enter＝Enter で改行", "optEnterSubmit": "Enter で送信", "optEnterNewline": "Enter で改行", "setNewCardPos": "新しいタイルの位置", "optAppend": "列の末尾", "optPrepend": "列の先頭", "optPrependCompact": "列の先頭(コンパクト)", "setRelativeDate": "相対日付を表示", "setRelativeDateDesc": "今日 / 明日 / N 日後", "setDateFormat": "日付の保存形式", "setDateFormatDesc": "markdown に書き込む形式（例 YYYY-MM-DD）", "setDateDisplay": "日付の表示形式", "setDateDisplayDesc": "タイルに表示する形式", "setDateTrigger": "日付トリガー文字", "setDateTriggerDesc": "既定 @", "setTimeTrigger": "時刻トリガー文字", "setTimeTriggerDesc": "既定 @@", "setLinkDaily": "日付をデイリーノートにリンク", "setLinkDailyDesc": "日付を @[[..]] と書きデイリーノートにリンク", "setTagAction": "タグクリックの動作", "setTagActionDesc": "タグをクリックしたときの動作：vault 全体を検索、またはこのボードだけを絞り込み。", "optSearchVault": "vault 全体を検索", "optFilterBoard": "このボードを絞り込み", "setMoveTags": "タグをタイルの下部へ移動", "setArchiveWithDate": "アーカイブ時にタイムスタンプ", "settingsTitle": "tugtile 設定", "settingsDesc": "これらはグローバル既定です。各ボードの同名設定が優先されます。", "gShowCheckboxes": "タイルのチェックボックスを表示", "gShowCheckboxesDesc": "各タイルの右上にチェックボックスを表示（- [ ] / - [x] を切替）", "gHideCount": "列のカウントを隠す", "gHideCountDesc": "列のヘッダーにタイル数を表示しない", "gResponsiveBoard": "レスポンシブボード（狭い画面で縦積み）", "gResponsiveBoardDesc": "画面が狭いとき、ボードを自動で縦一列に並べ替えます。", "gLaneWidth": "列の幅", "gLaneWidthDesc": "各列の幅。すべての列が同じ幅で揃います", "gTableDensity": "表の行間隔", "gTableDensityDesc": "表の各行の上下の間隔", "gFormatTools": "文字書式ボタン", "gFormatToolsDesc": "見出し・太字・斜体・打ち消し線。", "gInsertTools": "挿入ボタン", "gInsertToolsDesc": "表示する挿入ボタンを選択（コード／リンク／日付／時刻）", "optDenseTight": "詰める", "optDenseMid": "標準", "optDenseLoose": "ゆったり", "gEnterSubmit": "Enter で送信", "gEnterSubmitDesc": "オン：Enter で送信、Shift+Enter で改行（CJK 向け既定）。オフ：Enter で改行、Shift/⌘+Enter で送信", "gPrepend": "新しいタイルを先頭に追加", "gPrependDesc": "既定は末尾に追加。オンで先頭に追加", "gRelativeDate": "相対日付を表示", "gRelativeDateDesc": "タイルの日付に「今日 / 明日 / N 日後」を表示", "gDateDisplay": "日付の表示形式", "gDateDisplayDesc": "moment 形式トークン：YYYY / MM / DD（既定 YYYY-MM-DD）", "gArchiveWithDate": "アーカイブ時にタイムスタンプ", "gArchiveWithDateDesc": "アーカイブ時にタイトルの前へ **YYYY-MM-DD HH:mm** を付加", "gArchiveHeading": "アーカイブ見出し", "gArchiveHeadingDesc": "新しいアーカイブ節の見出し文字（例 Archive、封存）。", "gDanger": "危険な操作", "gReset": "既定値にリセット", "gResetDesc": "上記のグローバル設定を既定に戻す", "gResetBtn": "リセット", "cmdToggleView": "tugtile：ボード / markdown を切替", "cmdOpenAsBoard": "tugtile で開く", "cmdUndo": "tugtile：待った（元に戻す）", "cmdRedo": "tugtile：やり直し", "cmdCreateBoard": "tugtile：新しいボードを作成", "cmdSearch": "tugtile：タイルを検索（Cmd/Ctrl+F に割当可）", "cmdArchiveCompleted": "tugtile：完了したタイルをすべてアーカイブ", "cmdConvertToBoard": "tugtile：現在のノートをボードに変換", "cmdNewCard": "tugtile：列に新しいタイル", "cmdNewLane": "tugtile：列を追加", "cmdRenameLane": "tugtile：列名を変更", "createBoardHere": "ここに tugtile ボードを作成", "openAsBoard": "tugtile ボードで開く", "ribbonTitle": "tugtile ボード", "ribbonNoFile": "先にボードの .md を開いてください", "convertFailed": "tugtile 変換失敗：{0}", "boardCreated": "ボードを作成しました：{0}（ファイルエクスプローラーで名前変更可）", "createBoardFailed": "tugtile ボードの作成に失敗：{0}", "mtRibbon": "marktile で編集", "mtOpenCmd": "marktile：現在のノートを編集", "mtNoFile": "先に .md ノートを開いてください", "mtBackToObsidian": "Obsidian エディタに戻る", "openInMarktile": "marktile で開く", "mtToTugtile": "tugtile ボードで開く", "mtBrand": "marktile-ing", "mtBrandLocked": "marktile", "mtEssentialTools": "基本ボタン", "mtEssentialToolsDesc": "検索・待った・やり直し", "mtInsertToolsDesc": "表示する挿入ボタン（コード／リンク）", "mtDefaultEditor": "marktile を既定の Markdown エディタにする", "mtDefaultEditorDesc": "既定はオフ。オンにすると .md ファイルが Obsidian の標準エディタではなく marktile で開きます（ボードも同様、tugtile ボタンで移動）。反映には Obsidian の再読み込みが必要。いつでもオフにして標準エディタに戻せます。", "mtReloadRequired": "反映するには Obsidian を再読み込みしてください", "mtSettings": "marktile 設定", "mtSettingsTitle": "marktile 設定", "mtSettingsDesc": "marktile は任意の .md ノートを tile ファミリーのエディタで開きます。ツールバーに表示するボタンを選んだり（すべて外すとツールバーを完全に隠せます）、marktile を既定の Markdown エディタにできます。", "mtModePlain": "プレーン", "mtModeSeasoned": "アジツケ", "expandAllAction": "すべて展開", "collapseAllAction": "すべて折りたたむ", "expandLanesAction": "レーンを展開", "mtModeToggle": "アジツケ／プレーン切替", "mtLockToggle": "エディタをロック（読み取り専用）", "mtToc": "目次", "mtTocEmpty": "見出しなし", "edH1": "見出し 1", "edH2": "見出し 2", "edH3": "見出し 3", "edBold": "太字", "edItalic": "斜体", "edStrike": "取り消し線", "edClear": "書式をクリア", "edBullet": "箇条書き", "edNumber": "番号付きリスト", "edCheck": "チェックリスト", "edQuote": "引用", "edCode": "インラインコード", "edLink": "ウィキリンク", "edDate": "日付を挿入", "edTime": "時刻を挿入", "edFind": "検索／置換", "TBL_INS_COL_L": "左に列を挿入", "TBL_INS_COL_R": "右に列を挿入", "TBL_INS_ROW_A": "上に行を挿入", "TBL_INS_ROW_B": "下に行を挿入", "TBL_DEL_COL": "列を削除", "TBL_DEL_ROW": "行を削除", "TBL_MOV_COL_L": "列を左へ移動", "TBL_MOV_COL_R": "列を右へ移動", "TBL_MOV_ROW_U": "行を上へ移動", "TBL_MOV_ROW_D": "行を下へ移動", "TBL_SORT_ASC": "この列で並べ替え（昇順）", "TBL_SORT_DESC": "この列で並べ替え（降順）", "TBL_ALIGN": "表のソースを整列", "mtModeRendered": "レンダー", "mtModesPick": "表示モード", "mtModesPickDesc": "ビュー切り替えボタンが巡回するモード。最低 1 つは残ります。", "mtModesMinOne": "ビューモードは最低 1 つ残してください。", "gBlockTools": "ブロックツール", "gBlockToolsDesc": "リスト・チェック・引用・表。", "edTable": "表", "edImage": "画像を挿入", "edVideo": "動画を挿入", "edVideoPrompt": "動画 URL（YouTube／Vimeo／mp4）：", "mtSeasonedColor": "調味：カラフル配色", "mtSeasonedColorDesc": "見出し・太字・コード・リンクなどを単色アクセントではなく、それぞれの色で表示します。", "backupsAction": "バックアップ", "backupTitle": "ボードのバックアップ", "backupDesc": "tugtile はセッションごとの最初の変更前にこのボードを _tugtile-backups/ にスナップショットし、ファイルが他で編集されたら自動で再読み込みします。ミスや同期の衝突で作業を失いません。", "backupEmpty": "まだバックアップはありません。セッションごとの最初の変更前に自動で作成されます。", "backupOpen": "開く", "backupRestoreConfirm": "現在のボードをこのバックアップで置き換えますか？現在の状態は先にバックアップされるので元に戻せます。", "backupRestored": "tugtile：バックアップからボードを復元しました", "backupRestoreFailed": "tugtile：このバックアップを復元できませんでした", "safetyHeading": "あなたのデータは安全です", "backupRetentionName": "バックアップ履歴の上限", "backupRetentionDesc": "各ボードで保持するバックアップ数。超過分は古いものから削除（-1＝すべて保持）。", "familyMarktile": "marktile：姉妹エディタ", "familyMarktileDesc": "マーカーが隠れず、見出しが大きくなる Markdown エディタ。ここのカードエディタと同じエンジン・同じ操作感。", "familyTugtile": "tugtile：姉妹ボード", "familyTugtileDesc": "Markdown ノートを、引いて並べ替えるカードボードに。既存のボードも読み込めます。", "familyGet": "プラグインを見る", "familyHave": "tile ファミリーをすべて揃えています。", "keyboardHintName": "キーボード", "keyboardHint": "ヒント：カードをフォーカス（Tab かクリック）して矢印キーで移動：上下は同じレーン、左右はレーン間。", "searchAll": "すべての書類を検索", "searchAllPlaceholder": "すべての書類を検索", "searchAllHint": "この Mac のすべての Markdown ファイル。覚えている言葉を入力してください。", "searchAllNone": "見つかりません。一語だけにするか、別の言葉で試してください。", "searchAllStat": "{0} 件のファイル・{1} 件を表示", "searchAllOffline": "クラウドに未ダウンロードのファイルがあと {0} 件", "searchAllCapped": "新しい順に {1} 件中 {0} 件を読み込み"}, "ko-KR": {"appName": "태그타일", "brandSuffix": "tugtile-ing (태그타일 중)", "brandSuffixLocked": "tugtile (태그타일)", "lockToggle": "보드 잠금/해제", "lockedNotice": "보드가 잠겨 있습니다", "undoAction": "무르기", "redoAction": "다시 실행", "viewSwitchAction": "보기 전환 (보드 / 표)", "boardSettingsAction": "이 보드 설정", "openAsMarkdownAction": "마크다운으로 열기", "archiveAction": "보관함", "searchAction": "타일 검색", "emptyNoFile": "보드 .md에서 “tugtile로 열기” 명령을 사용하세요.", "fileNotFound": "파일을 찾을 수 없습니다: {0}", "searchPlaceholder": "타일 찾기", "viewBoard": "보드", "viewTable": "표", "editMarkdown": "Markdown 원본 편집", "findPlaceholder": "찾기", "replacePlaceholder": "바꿀 내용", "findPrev": "이전", "findNext": "다음", "replaceOne": "바꾸기", "replaceAll": "모두 바꾸기", "colTile": "타일", "colLane": "열", "colDate": "날짜", "colTags": "태그", "collapseExpand": "접기 / 펼치기", "laneActionsAria": "열 작업 (이름 변경 / 삽입 / 정렬 / 보관 / 삭제…)", "tileActionsAria": "추가 작업 (편집 / 보관 / 삭제…)", "relDateWrap": " ({0})", "today": "오늘", "tomorrow": "내일", "yesterday": "어제", "dayAfterTomorrow": "모레", "dayBeforeYesterday": "그저께", "daysLater": "{0}일 후", "daysAgo": "{0}일 전", "yearMonth": "{0}년 {1}월", "weekdays": ["일", "월", "화", "수", "목", "금", "토"], "edit": "편집", "duplicateTile": "타일 복제", "insertTileAbove": "위에 타일 삽입", "insertTileBelow": "아래에 타일 삽입", "splitTileMenu": "분할", "archiveTileMenu": "보관", "moveTileTop": "열 맨 위로", "moveTileBottom": "열 맨 아래로", "untitledLane": "(제목 없음)", "moveToLane": "“{0}”(으)로 이동", "deleteTileMenu": "타일 버리기", "splitNoNeed": "한 줄뿐이라 분할할 수 없습니다.", "splitDone": "{0}장의 타일로 분할했습니다", "archivedTile": "타일을 보관했습니다", "deletedTile": "타일을 버렸습니다", "deletedLane": "열을 삭제했습니다", "toastUndoBtn": "무르기", "addTileBtn": "＋ 타일 추가", "dropToArchive": "여기에 놓아 보관", "cancel": "취소", "save": "저장", "discardConfirm": "변경 사항을 취소할까요?", "editLost": "이 타일은 더 이상 존재하지 않아 편집이 저장되지 않았습니다.", "mobileSubmit": "전송", "addLaneBtn": "＋ 열 추가", "addLanePlaceholder": "열 이름　⏎ 추가", "newLane": "새 열", "newBoardName": "새 보드", "confirmDeleteLane": "이 열에 타일이 {0}장 있습니다. 열 전체를 삭제할까요?", "boardListViewOnly": "보드 보기에서 사용하세요", "archivedCompleted": "완료된 타일 {0}장을 보관했습니다", "noCompleted": "완료된 타일이 없습니다", "rename": "이름 변경", "insertLaneBefore": "앞에 열 삽입", "insertLaneAfter": "뒤에 열 삽입", "sortTitleAsc": "타일 제목 정렬 A→Z", "sortTitleDesc": "타일 제목 정렬 Z→A", "sortDate": "날짜 정렬 (가까운 순)", "sortTag": "태그 정렬", "markLaneComplete": "이 열 전체 완료 표시", "archiveLaneMenu": "이 열의 타일 모두 보관", "deleteLaneMenu": "열 삭제", "confirmArchiveLane": "이 열의 타일 {0}장을 모두 보관할까요?", "archivedLane": "이 열의 타일 {0}장을 보관했습니다", "noLaneToRestore": "tugtile: 복원할 열이 없습니다. 먼저 열을 만드세요", "externalModified": "tugtile: 이 파일이 다른 곳에서 변경되어 덮어쓰기를 막기 위해 다시 불러왔습니다(이 작업은 저장되지 않음)", "backupFailed": "tugtile: 백업에 실패하여 데이터 보호를 위해 저장을 취소했습니다", "writeFailed": "tugtile 저장 실패: {0}", "saved": "저장됨", "persistFailed": "tugtile: 저장 실패, {0}", "undoVerb": "무르기", "redoVerb": "다시 실행", "noStep": "tugtile: {0}할 단계가 없습니다", "timeTraveled": "tugtile: {0} 완료(무르기 {1} / 다시 실행 {2})", "archiveTitle": "보관함", "archiveEmpty": "보관된 타일이 없습니다.", "restore": "복원", "deleteArchived": "타일 버리기", "boardSettingsTitle": "이 보드 설정", "boardSettingsDesc": "이 보드만 변경합니다(보드 파일에 저장). 비워두면 전역 기본값을 따릅니다.", "migrateBtn": "tugtile 형식으로 업그레이드", "migrateBtnDesc": "obsidian-kanban 마커를 제거하여 이 보드를 tugtile 네이티브로 만듭니다. 일방향.", "migrateConfirm": "이 보드를 tugtile 자체 형식으로 업그레이드할까요? 이후 obsidian-kanban으로 열 수 없으며 kanban 전용 설정은 삭제됩니다.", "migrateDone": "tugtile 형식으로 업그레이드됨", "confirm": "확인", "setShowCheckboxes": "타일 체크박스 표시", "setHideCount": "열 카운트 숨기기", "setEnterBehavior": "Enter 키 동작", "setEnterBehaviorDesc": "shift-enter＝Enter로 전송(CJK 친화); enter＝Enter로 줄바꿈", "optEnterSubmit": "Enter로 전송", "optEnterNewline": "Enter로 줄바꿈", "setNewCardPos": "새 타일 위치", "optAppend": "열 맨 아래", "optPrepend": "열 맨 위", "optPrependCompact": "열 맨 위(간단)", "setRelativeDate": "상대 날짜 표시", "setRelativeDateDesc": "오늘 / 내일 / N일 후", "setDateFormat": "날짜 저장 형식", "setDateFormatDesc": "마크다운에 기록하는 형식(예: YYYY-MM-DD)", "setDateDisplay": "날짜 표시 형식", "setDateDisplayDesc": "타일에 표시되는 형식", "setDateTrigger": "날짜 트리거 문자", "setDateTriggerDesc": "기본 @", "setTimeTrigger": "시간 트리거 문자", "setTimeTriggerDesc": "기본 @@", "setLinkDaily": "날짜를 데일리 노트에 링크", "setLinkDailyDesc": "날짜를 @[[..]]로 작성해 데일리 노트에 링크", "setTagAction": "태그 클릭 동작", "setTagActionDesc": "태그를 클릭할 때의 동작: 전체 vault 검색, 또는 이 보드만 필터.", "optSearchVault": "전체 vault 검색", "optFilterBoard": "이 보드 필터", "setMoveTags": "태그를 타일 하단으로 이동", "setArchiveWithDate": "보관 시 타임스탬프 추가", "settingsTitle": "tugtile 설정", "settingsDesc": "이것은 전역 기본값이며, 각 보드의 동일한 이름 설정이 우선합니다.", "gShowCheckboxes": "타일 체크박스 표시", "gShowCheckboxesDesc": "각 타일 오른쪽 위에 체크박스 표시(- [ ] / - [x] 전환)", "gHideCount": "열 카운트 숨기기", "gHideCountDesc": "열 헤더에 타일 수를 표시하지 않음", "gResponsiveBoard": "반응형 보드 (좁은 창에서 세로 정렬)", "gResponsiveBoardDesc": "창이 좁아지면 보드를 자동으로 세로 한 줄로 재배치합니다.", "gLaneWidth": "열 너비", "gLaneWidthDesc": "각 열의 너비: 모든 열이 같은 너비로 정렬됩니다", "gTableDensity": "표 행 간격", "gTableDensityDesc": "표 각 행의 위아래 간격", "gFormatTools": "텍스트 서식 버튼", "gFormatToolsDesc": "제목, 굵게, 기울임, 취소선.", "gInsertTools": "삽입 버튼", "gInsertToolsDesc": "표시할 삽입 버튼 선택(코드/링크/날짜/시간)", "optDenseTight": "촘촘", "optDenseMid": "보통", "optDenseLoose": "넓게", "gEnterSubmit": "Enter로 전송", "gEnterSubmitDesc": "켬: Enter로 전송, Shift+Enter로 줄바꿈(CJK 친화 기본). 끔: Enter로 줄바꿈, Shift/⌘+Enter로 전송", "gPrepend": "새 타일을 맨 위에 추가", "gPrependDesc": "기본은 맨 아래에 추가; 켜면 맨 위에 추가", "gRelativeDate": "상대 날짜 표시", "gRelativeDateDesc": "타일 날짜에 “오늘 / 내일 / N일 후” 표시", "gDateDisplay": "날짜 표시 형식", "gDateDisplayDesc": "moment 형식 토큰: YYYY / MM / DD(기본 YYYY-MM-DD)", "gArchiveWithDate": "보관 시 타임스탬프 추가", "gArchiveWithDateDesc": "보관 시 제목 앞에 **YYYY-MM-DD HH:mm** 추가", "gArchiveHeading": "보관함 제목", "gArchiveHeadingDesc": "새 보관(아카이브) 섹션의 제목 문자(예: Archive, 封存).", "gDanger": "위험 작업", "gReset": "기본값으로 재설정", "gResetDesc": "위 전역 설정을 기본값으로 되돌립니다", "gResetBtn": "재설정", "cmdToggleView": "tugtile: 보드 / markdown 전환", "cmdOpenAsBoard": "tugtile로 열기", "cmdUndo": "tugtile: 무르기(실행 취소)", "cmdRedo": "tugtile: 다시 실행", "cmdCreateBoard": "tugtile: 새 보드 만들기", "cmdSearch": "tugtile: 타일 검색(Cmd/Ctrl+F에 바인딩 가능)", "cmdArchiveCompleted": "tugtile: 완료된 타일 모두 보관", "cmdConvertToBoard": "tugtile: 현재 노트를 보드로 변환", "cmdNewCard": "tugtile: 열에 새 타일", "cmdNewLane": "tugtile: 열 추가", "cmdRenameLane": "tugtile: 열 이름 변경", "createBoardHere": "여기에 tugtile 보드 만들기", "openAsBoard": "tugtile 보드로 열기", "ribbonTitle": "tugtile 보드", "ribbonNoFile": "먼저 보드 .md 파일을 여세요", "convertFailed": "tugtile 변환 실패: {0}", "boardCreated": "보드를 만들었습니다: {0}(파일 탐색기에서 이름 변경 가능)", "createBoardFailed": "tugtile 보드 생성 실패: {0}", "mtRibbon": "marktile로 편집", "mtOpenCmd": "marktile: 현재 노트 편집", "mtNoFile": ".md 노트를 먼저 여세요", "mtBackToObsidian": "Obsidian 편집기로", "openInMarktile": "marktile에서 열기", "mtToTugtile": "tugtile 보드로 열기", "mtBrand": "marktile-ing", "mtBrandLocked": "marktile", "mtEssentialTools": "기본 버튼", "mtEssentialToolsDesc": "검색・무르기・다시 실행", "mtInsertToolsDesc": "표시할 삽입 버튼 (코드 / 링크)", "mtDefaultEditor": "marktile을 기본 Markdown 편집기로 설정", "mtDefaultEditorDesc": "기본은 꺼짐. 켜면 .md 파일이 Obsidian 기본 편집기 대신 marktile로 열립니다(보드 파일도 포함, tugtile 버튼으로 이동). 적용하려면 Obsidian을 다시 로드하세요. 언제든 꺼서 기본 편집기로 되돌릴 수 있습니다.", "mtReloadRequired": "적용하려면 Obsidian을 다시 로드하세요", "mtSettings": "marktile 설정", "mtSettingsTitle": "marktile 설정", "mtSettingsDesc": "marktile은 모든 .md 노트를 tile 패밀리 편집기로 엽니다. 도구 모음에 표시할 버튼을 선택하거나(모두 해제하면 도구 모음을 완전히 숨길 수 있음), marktile을 기본 Markdown 편집기로 설정할 수 있습니다.", "mtModePlain": "담백", "mtModeSeasoned": "양념", "expandAllAction": "모두 펼치기", "collapseAllAction": "모두 접기", "expandLanesAction": "레인 펼치기", "mtModeToggle": "양념 / 담백 전환", "mtLockToggle": "편집기 잠금(읽기 전용)", "mtToc": "목차", "mtTocEmpty": "제목 없음", "edH1": "제목 1", "edH2": "제목 2", "edH3": "제목 3", "edBold": "굵게", "edItalic": "기울임", "edStrike": "취소선", "edClear": "서식 지우기", "edBullet": "글머리 목록", "edNumber": "번호 목록", "edCheck": "체크리스트", "edQuote": "인용", "edCode": "인라인 코드", "edLink": "위키링크", "edDate": "날짜 삽입", "edTime": "시간 삽입", "edFind": "찾기 / 바꾸기", "TBL_INS_COL_L": "왼쪽에 열 삽입", "TBL_INS_COL_R": "오른쪽에 열 삽입", "TBL_INS_ROW_A": "위에 행 삽입", "TBL_INS_ROW_B": "아래에 행 삽입", "TBL_DEL_COL": "열 삭제", "TBL_DEL_ROW": "행 삭제", "TBL_MOV_COL_L": "열을 왼쪽으로 이동", "TBL_MOV_COL_R": "열을 오른쪽으로 이동", "TBL_MOV_ROW_U": "행을 위로 이동", "TBL_MOV_ROW_D": "행을 아래로 이동", "TBL_SORT_ASC": "이 열 기준 정렬(오름차순)", "TBL_SORT_DESC": "이 열 기준 정렬(내림차순)", "TBL_ALIGN": "표 소스 정렬", "mtModeRendered": "렌더", "mtModesPick": "보기 모드", "mtModesPickDesc": "보기 전환 버튼이 순환하는 모드. 최소 하나는 켜져 있습니다.", "mtModesMinOne": "보기 모드는 최소 하나 남겨 두세요.", "gBlockTools": "블록 도구", "gBlockToolsDesc": "목록, 체크리스트, 인용, 표.", "edTable": "표", "edImage": "이미지 삽입", "edVideo": "동영상 삽입", "edVideoPrompt": "동영상 URL (YouTube / Vimeo / mp4):", "mtSeasonedColor": "시즈닝: 컬러 구문", "mtSeasonedColorDesc": "제목·굵게·코드·링크 등을 단일 강조색 대신 각각의 색으로 표시합니다.", "backupsAction": "백업", "backupTitle": "보드 백업", "backupDesc": "tugtile은 세션마다 첫 변경 전에 이 보드를 _tugtile-backups/에 스냅샷하고, 파일이 다른 곳에서 편집되면 자동으로 다시 불러옵니다. 실수나 동기화 충돌로 작업을 잃지 않습니다.", "backupEmpty": "아직 백업이 없습니다. 세션마다 첫 변경 전에 자동으로 만들어집니다.", "backupOpen": "열기", "backupRestoreConfirm": "현재 보드를 이 백업으로 교체할까요? 현재 상태가 먼저 백업되므로 되돌릴 수 있습니다.", "backupRestored": "tugtile: 백업에서 보드를 복원했습니다", "backupRestoreFailed": "tugtile: 이 백업을 복원할 수 없습니다", "safetyHeading": "데이터는 안전합니다", "backupRetentionName": "백업 기록 한도", "backupRetentionDesc": "보드마다 보관할 백업 수. 초과 시 오래된 것부터 삭제(-1 = 모두 보관).", "familyMarktile": "marktile: 자매 에디터", "familyMarktileDesc": "마커가 숨지 않고 제목이 커지는 Markdown 에디터. 여기 카드 에디터와 같은 엔진, 같은 느낌.", "familyTugtile": "tugtile: 자매 보드", "familyTugtileDesc": "Markdown 노트를 끌어서 재정렬하는 카드 보드로. 기존 보드도 읽습니다.", "familyGet": "플러그인 보기", "familyHave": "이미 tile 패밀리를 모두 갖추셨습니다.", "keyboardHintName": "키보드", "keyboardHint": "팁: 카드를 포커스(Tab 또는 클릭)하고 화살표 키로 이동: 위/아래는 같은 레인, 좌/우는 레인 간.", "searchAll": "모든 문서 검색", "searchAllPlaceholder": "모든 문서 검색", "searchAllHint": "이 Mac의 모든 Markdown 파일. 기억나는 단어를 입력하세요.", "searchAllNone": "없습니다. 한 단어만 쓰거나 다른 단어로 시도해 보세요.", "searchAllStat": "파일 {0}개 · {1}개 표시", "searchAllOffline": "클라우드에 내려받지 않은 파일 {0}개 더", "searchAllCapped": "최신순으로 {1}개 중 {0}개를 읽음"}, "zh-TW": {"appName": "理牌", "brandSuffix": "tugtile-ing（理牌中）", "brandSuffixLocked": "tugtile（理牌）", "lockToggle": "鎖定／解鎖牌桌", "lockedNotice": "牌桌已鎖定", "undoAction": "悔牌（復原）", "redoAction": "重出（重做）", "viewSwitchAction": "切換檢視（牌桌／牌表）", "boardSettingsAction": "本牌桌設定", "openAsMarkdownAction": "以 markdown 開啟", "archiveAction": "牌庫（收牌區）", "searchAction": "搜尋牌", "emptyNoFile": "在某張牌桌 .md 上用指令「以 tugtile 開啟」。", "fileNotFound": "找不到檔案：{0}", "searchPlaceholder": "找牌", "viewBoard": "牌桌", "viewTable": "牌表", "editMarkdown": "編輯 Markdown 原始碼", "findPlaceholder": "尋找", "replacePlaceholder": "取代為", "findPrev": "上一個", "findNext": "下一個", "replaceOne": "取代", "replaceAll": "全部取代", "colTile": "牌", "colLane": "牌列", "colDate": "日期", "colTags": "標籤", "collapseExpand": "收合 / 展開", "laneActionsAria": "牌列動作（改名／插入／排序／收牌／棄牌…）", "tileActionsAria": "更多動作（編輯／收牌／棄牌…）", "relDateWrap": "（{0}）", "today": "今天", "tomorrow": "明天", "yesterday": "昨天", "dayAfterTomorrow": "後天", "dayBeforeYesterday": "前天", "daysLater": "{0} 天後", "daysAgo": "{0} 天前", "yearMonth": "{0} 年 {1} 月", "weekdays": ["日", "一", "二", "三", "四", "五", "六"], "edit": "編輯", "duplicateTile": "複製牌", "insertTileAbove": "在上方新增牌", "insertTileBelow": "在下方新增牌", "splitTileMenu": "拆分成多張", "archiveTileMenu": "收牌（封存）", "moveTileTop": "移到牌列頂", "moveTileBottom": "移到牌列底", "untitledLane": "(未命名)", "moveToLane": "移到「{0}」", "deleteTileMenu": "棄牌", "splitNoNeed": "只有一行，無需拆分", "splitDone": "已拆分成 {0} 張牌", "archivedTile": "已收牌（封存）", "deletedTile": "已棄牌", "deletedLane": "已刪牌列", "toastUndoBtn": "悔牌", "addTileBtn": "＋ 新增一張牌", "dropToArchive": "拖到這裡收牌", "cancel": "取消", "save": "儲存", "discardConfirm": "放棄這次的變更？", "editLost": "這張牌已不存在，編輯未儲存。", "mobileSubmit": "送出", "addLaneBtn": "＋ 新增牌列", "addLanePlaceholder": "牌列名稱　⏎ 新增", "newLane": "新牌列", "newBoardName": "新牌桌", "confirmDeleteLane": "這個牌列有 {0} 張牌，確定刪除整列？", "boardListViewOnly": "請在牌桌檢視使用", "archivedCompleted": "已收 {0} 張已完成牌", "noCompleted": "沒有已完成的牌", "rename": "改名", "insertLaneBefore": "在前面插入牌列", "insertLaneAfter": "在後面插入牌列", "sortTitleAsc": "依牌面排序 A→Z", "sortTitleDesc": "依牌面排序 Z→A", "sortDate": "依日期排序（近→遠）", "sortTag": "依標籤排序", "markLaneComplete": "標記本列全部完成", "archiveLaneMenu": "收本列所有牌", "deleteLaneMenu": "刪除牌列", "confirmArchiveLane": "把這列的 {0} 張牌全部收進牌庫？", "archivedLane": "已收本列 {0} 張牌", "noLaneToRestore": "理牌：沒有可還原到的牌列，請先建一列", "externalModified": "理牌：偵測到此檔在別處被修改，已重新載入以免覆蓋（剛才這步未寫入）", "backupFailed": "理牌：備份失敗，為保護資料已取消這次寫回", "writeFailed": "理牌寫回失敗：{0}", "saved": "已儲存", "persistFailed": "理牌：存檔失敗，{0}", "undoVerb": "悔牌", "redoVerb": "重出", "noStep": "理牌：沒有可{0}的步驟了", "timeTraveled": "理牌：已{0}（可悔牌 {1} / 可重出 {2}）", "archiveTitle": "牌庫", "archiveEmpty": "牌庫裡沒有牌。", "restore": "取回", "deleteArchived": "棄牌", "boardSettingsTitle": "本牌桌設定", "boardSettingsDesc": "只改這個牌桌（隨牌桌檔案儲存）。空白＝跟隨全域預設。", "migrateBtn": "升級成 tugtile 格式", "migrateBtnDesc": "移除 obsidian-kanban 標記，讓這個牌桌成為 tugtile 原生格式。單向不可逆。", "migrateConfirm": "要把這個牌桌升級成 tugtile 原生格式嗎？升級後將無法用 obsidian-kanban 開啟，且會清掉 kanban 專屬設定。", "migrateDone": "已升級成 tugtile 格式", "confirm": "確定", "setShowCheckboxes": "顯示牌的勾選框", "setHideCount": "隱藏牌列計數", "setEnterBehavior": "Enter 鍵行為", "setEnterBehaviorDesc": "shift-enter＝Enter 送出（CJK 友善）；enter＝Enter 換行", "optEnterSubmit": "Enter 送出", "optEnterNewline": "Enter 換行", "setNewCardPos": "新牌位置", "optAppend": "加在牌列底", "optPrepend": "加在牌列頂", "optPrependCompact": "加在牌列頂(精簡)", "setRelativeDate": "顯示相對日期", "setRelativeDateDesc": "今天 / 明天 / N 天後", "setDateFormat": "日期儲存格式", "setDateFormatDesc": "插入日期寫進 markdown 的格式（如 YYYY-MM-DD）", "setDateDisplay": "日期顯示格式", "setDateDisplayDesc": "牌上顯示的格式", "setDateTrigger": "日期觸發字元", "setDateTriggerDesc": "預設 @", "setTimeTrigger": "時間觸發字元", "setTimeTriggerDesc": "預設 @@", "setLinkDaily": "日期連每日筆記", "setLinkDailyDesc": "日期寫成 @[[..]] 連到每日筆記", "setTagAction": "點標籤行為", "setTagActionDesc": "點標籤時的動作：搜尋整個 vault，或只篩這個牌桌。", "optSearchVault": "搜整個 vault", "optFilterBoard": "篩本牌桌", "setMoveTags": "標籤移到牌底", "setArchiveWithDate": "收牌時加時間戳", "settingsTitle": "理牌設定", "settingsDesc": "這些是全域預設；個別牌桌的同名設定會優先。", "gShowCheckboxes": "顯示牌的勾選框", "gShowCheckboxesDesc": "在每張牌右上角顯示勾選框（可切換 - [ ] / - [x]）", "gHideCount": "隱藏牌列計數", "gHideCountDesc": "不在牌列標題列顯示牌數", "gResponsiveBoard": "自適應牌桌（窄面板直排）", "gResponsiveBoardDesc": "面板變窄時，牌桌自動改成單欄直向堆疊。", "gLaneWidth": "牌列寬度", "gLaneWidthDesc": "每個牌列的寬度，所有牌列等寬對齊", "gTableDensity": "牌表行距", "gTableDensityDesc": "牌表每列的上下間距", "gFormatTools": "文字格式按鈕", "gFormatToolsDesc": "標題、粗體、斜體、刪除線。", "gInsertTools": "插入按鈕", "gInsertToolsDesc": "選擇要顯示哪些插入按鈕（程式碼／連結／日期／時間）", "optDenseTight": "緊湊", "optDenseMid": "適中", "optDenseLoose": "寬鬆", "gEnterSubmit": "Enter 鍵送出", "gEnterSubmitDesc": "開：Enter 送出、Shift+Enter 換行（CJK 友善預設）。關：Enter 換行、Shift/⌘+Enter 送出", "gPrepend": "新牌加在牌列頂", "gPrependDesc": "預設加在牌列底；開啟改為加在牌列頂", "gRelativeDate": "顯示相對日期", "gRelativeDateDesc": "牌日期顯示「今天 / 明天 / N 天後」", "gDateDisplay": "日期顯示格式", "gDateDisplayDesc": "moment 風格 token：YYYY / MM / DD（預設 YYYY-MM-DD）", "gArchiveWithDate": "收牌時加時間戳", "gArchiveWithDateDesc": "收牌時在標題前加上 **YYYY-MM-DD HH:mm**", "gArchiveHeading": "牌庫標題", "gArchiveHeadingDesc": "新建牌庫（封存）區段用的標題文字（例如 Archive、封存）。", "gDanger": "危險操作", "gReset": "重設為預設值", "gResetDesc": "把上述全域設定還原成預設", "gResetBtn": "重設", "cmdToggleView": "理牌：切換牌桌 / markdown", "cmdOpenAsBoard": "以 tugtile 開啟", "cmdUndo": "理牌：悔牌（復原）", "cmdRedo": "理牌：重出（重做）", "cmdCreateBoard": "理牌：建立新牌桌", "cmdSearch": "理牌：搜尋牌（可綁 Cmd/Ctrl+F）", "cmdArchiveCompleted": "理牌：收全牌桌已完成牌", "cmdConvertToBoard": "理牌：把目前筆記轉成牌桌", "cmdNewCard": "理牌：在牌列新增一張牌", "cmdNewLane": "理牌：新增牌列", "cmdRenameLane": "理牌：改牌列名稱", "createBoardHere": "在此建立 tugtile 牌桌", "openAsBoard": "以 tugtile 牌桌開啟", "ribbonTitle": "tugtile 牌桌", "ribbonNoFile": "請先開啟一個牌桌 .md 檔", "convertFailed": "理牌轉換失敗：{0}", "boardCreated": "已建立牌桌：{0}（可在檔案總管改名）", "createBoardFailed": "理牌建立牌桌失敗：{0}", "mtRibbon": "用 marktile 編輯", "mtOpenCmd": "marktile：編輯目前筆記", "mtNoFile": "請先開啟一個 .md 筆記", "mtBackToObsidian": "回 Obsidian 編輯器", "openInMarktile": "開進 marktile", "mtToTugtile": "以 tugtile 牌桌開啟", "mtBrand": "marktile-ing", "mtBrandLocked": "marktile", "mtEssentialTools": "基本按鈕", "mtEssentialToolsDesc": "搜尋、復原、重做", "mtInsertToolsDesc": "要顯示哪些插入按鈕（程式碼／連結）", "mtDefaultEditor": "將 marktile 設為預設 Markdown 編輯器", "mtDefaultEditorDesc": "預設關閉。開啟後 .md 檔會用 marktile 開啟，而非 Obsidian 內建編輯器（看板檔也是，可用 tugtile 按鈕跳過去）。需重新載入 Obsidian 生效；隨時可關閉以還原原生編輯器。", "mtReloadRequired": "請重新載入 Obsidian 以生效", "mtSettings": "marktile 設定", "mtSettingsTitle": "marktile 設定", "mtSettingsDesc": "marktile 用 tile 家族的編輯器打開任何 .md 筆記。在這裡選擇工具列要顯示哪些按鈕（全部取消即可完全隱藏工具列），或將 marktile 設為預設的 Markdown 編輯器。", "mtModePlain": "原味", "mtModeSeasoned": "調味", "expandAllAction": "全展開", "collapseAllAction": "全收起", "expandLanesAction": "展開牌列", "mtModeToggle": "切換 調味／原味", "mtLockToggle": "鎖定編輯器（唯讀）", "mtToc": "目錄", "mtTocEmpty": "沒有標題", "edH1": "標題 1", "edH2": "標題 2", "edH3": "標題 3", "edBold": "粗體", "edItalic": "斜體", "edStrike": "刪除線", "edClear": "清除格式", "edBullet": "項目清單", "edNumber": "編號清單", "edCheck": "核取清單", "edQuote": "引言", "edCode": "行內程式碼", "edLink": "雙向連結", "edDate": "插入日期", "edTime": "插入時間", "edFind": "尋找／取代", "TBL_INS_COL_L": "在左方插入欄", "TBL_INS_COL_R": "在右方插入欄", "TBL_INS_ROW_A": "在上方插入列", "TBL_INS_ROW_B": "在下方插入列", "TBL_DEL_COL": "刪除欄", "TBL_DEL_ROW": "刪除列", "TBL_MOV_COL_L": "將此欄左移", "TBL_MOV_COL_R": "將此欄右移", "TBL_MOV_ROW_U": "將此列上移", "TBL_MOV_ROW_D": "將此列下移", "TBL_SORT_ASC": "依此欄排序（遞增）", "TBL_SORT_DESC": "依此欄排序（遞減）", "TBL_ALIGN": "對齊表格原始碼", "mtModeRendered": "渲染", "mtModesPick": "檢視模式", "mtModesPickDesc": "檢視循環按鈕會輪替哪些模式。至少保留一個。", "mtModesMinOne": "至少保留一個檢視模式。", "gBlockTools": "區塊工具", "gBlockToolsDesc": "清單、核取、引用、表格。", "edTable": "表格", "edImage": "插入圖片", "edVideo": "插入影片", "edVideoPrompt": "影片網址（YouTube／Vimeo／mp4）：", "mtSeasonedColor": "調味：彩色語法染色", "mtSeasonedColorDesc": "標題、粗體、行內碼、連結等各用自己的顏色，而非單一強調色。", "backupsAction": "備份", "backupTitle": "牌桌備份", "backupDesc": "tugtile 在每個工作階段第一次改動前，會把這張牌桌快照到 _tugtile-backups/，並在檔案被別處編輯時自動重載，一次手殘或同步衝突都不會弄丟你的東西。", "backupEmpty": "還沒有備份。每個工作階段第一次改動前會自動建一份。", "backupOpen": "開啟", "backupRestoreConfirm": "用這份備份取代目前的牌桌？會先備份目前狀態，所以可以還原回來。", "backupRestored": "理牌：已從備份還原牌桌", "backupRestoreFailed": "理牌：無法還原這份備份", "safetyHeading": "你的資料是安全的", "backupRetentionName": "版本記錄上限", "backupRetentionDesc": "每張牌桌最多保留幾份備份，超過自動刪最舊（-1＝全部保留）。", "familyMarktile": "marktile：同源編輯器", "familyMarktileDesc": "標記永不隱藏、標題會長大的 Markdown 編輯器，跟這裡的卡片編輯器同一個引擎、同一種手感。", "familyTugtile": "tugtile：同源牌桌", "familyTugtileDesc": "把你的 Markdown 筆記變成可以「拉」著重排的牌桌，還能讀你既有的牌桌。", "familyGet": "查看外掛", "familyHave": "你已經擁有完整的 tile 家族了。", "keyboardHintName": "鍵盤", "keyboardHint": "小技巧：聚焦一張卡片（Tab 或點一下），用方向鍵搬動它：上下在同一牌列、左右跨牌列。", "searchAll": "搜尋所有文件", "searchAllPlaceholder": "搜尋所有文件", "searchAllHint": "這台 Mac 上的每一個 Markdown 檔案。輸入你記得的字。", "searchAllNone": "找不到。試試只用一個詞，或換一個猜法。", "searchAllStat": "{0} 個檔案・顯示 {1} 個", "searchAllOffline": "雲端上還有 {0} 個尚未下載", "searchAllCapped": "由新到舊讀了 {1} 個中的 {0} 個"}};   // injected by build-marktile.sh
function t(key, ...args) {
  let s = (TR[LOCALE] && TR[LOCALE][key]);
  if (s == null) s = TR['en-US'] && TR['en-US'][key];
  if (s == null) return key;
  if (typeof s === 'string' && args.length) s = s.replace(/\{(\d+)\}/g, (m, i) => (args[+i] != null ? args[+i] : m));
  return s;
}

/* tile-family shared editor core — the SINGLE source of the editor engine used by BOTH plugins.
   Extracted from tugtile's plugin.src.js (the former //#core-start/#core-end blocks). The builds
   inject this file at each plugin's core-inline marker. It uses Obsidian element helpers / setIcon /
   Platform / Modal, which both Obsidian-plugin consumers provide (de-Obsidian-ifying for the web host is a
   later, separate step). EDITOR_TOOLS + escHtml + highlighters + listContinuation + tabEdit +
   tocHeadings + moveSection + mountEditor + TileEditModal. */

const EDITOR_TOOLS = [
  // fixed: always shown, not user-toggleable (essentials). tip = i18n key for the hover/aria label.
  { key: 'search', icon: 'search', fixed: true, tip: 'edFind' }, { key: 'undo', icon: 'undo', fixed: true, tip: 'undoAction' }, { key: 'redo', icon: 'redo', fixed: true, tip: 'redoAction' }, 'sep',
  // icons verified present in Obsidian's bundled Lucide subset (not all of Lucide ships); g = text fallback when no icon
  { key: 'h1', g: 'H1', icon: 'heading-1', cat: 'format', tip: 'edH1' }, { key: 'h2', g: 'H2', icon: 'heading-2', cat: 'format', tip: 'edH2' }, { key: 'h3', g: 'H3', icon: 'heading-3', cat: 'format', tip: 'edH3' }, 'sep',
  { key: 'bold', g: 'B', icon: 'bold', cat: 'format', tip: 'edBold' }, { key: 'italic', g: 'I', icon: 'italic', cat: 'format', tip: 'edItalic' }, { key: 'strike', g: 'S', icon: 'strikethrough', cat: 'format', tip: 'edStrike' }, { key: 'clear', g: 'Tx', icon: 'remove-formatting', cat: 'format', tip: 'edClear' }, 'rowbreak',   // phone: wrap to a third toolbar row here (desktop treats it as a separator)
  // block tools (lists / quote / table) — split out of 'format' (which is now just headings + inline marks)
  { key: 'bullet', g: '•', icon: 'list', cat: 'block', tip: 'edBullet' }, { key: 'number', g: '1.', icon: 'list-ordered', cat: 'block', tip: 'edNumber' }, { key: 'check', g: '☑', icon: 'list-checks', cat: 'block', tip: 'edCheck' }, { key: 'quote', g: '❝', icon: 'text-quote', cat: 'block', tip: 'edQuote' }, { key: 'table', g: '⊞', icon: 'table', cat: 'block', tip: 'edTable' }, 'sep',
  { key: 'code', g: '</>', icon: 'code', cat: 'insert', tip: 'edCode' }, { key: 'link', g: '[[ ]]', icon: 'link', cat: 'insert', tip: 'edLink' },
  // image/video: capability lives in the core, NOT injected per-surface. Each host wires the platform seam via
  // opts.pickImage / opts.pickVideo (Obsidian: vault save / web: upload) — `needs` hides the button when unwired.
  { key: 'image', g: 'IMG', icon: 'image', cat: 'insert', tip: 'edImage', needs: 'pickImage' }, { key: 'video', g: 'VID', icon: 'video', cat: 'insert', tip: 'edVideo', needs: 'pickVideo' }, 'sep',
  { key: 'date', g: '@', icon: 'calendar', cat: 'insert', tip: 'edDate' }, { key: 'time', g: '@@', icon: 'clock', cat: 'insert', tip: 'edTime' },
];

// Centered modal editor for cards: large centered card, darkened background, virtual keyboard adjusts modal container, saves changes on close
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// tile-cssmd — the "render markdown with markers HIDDEN via CSS" primitive, extracted as a
// SHARED, zero-dependency, render-only module. The technique (born in marktile's "Seasoned"
// renderer, later reused by another host's inline bar): wrap each markdown MARKER in a hidden span
// (`<prefix>-mk`, hidden by `.<prefix>-mk{display:none}`) and the CONTENT in an EFFECT span
// (`<prefix>-b` bold / `<prefix>-i` italic / `<prefix>-code`). The rendered text shows the
// effect while the raw markers stay invisible-but-present in the DOM — so the text↔DOM round
// trip (getText reads textContent, markers included) stays exact, and a host that opts in
// hides the markers via one CSS rule.
//
// This is the INLINE subset of the family's `highlightLineParts` (editor-core.js), made
// namespace-neutral: the tile plugins use `tg-*`, another host uses `gd-*`, a preview
// bar could use `gp-*` — all from ONE source. The faithful superset of:
//   • editor-core.js highlightLineParts inline marks (tg-b / tg-i / tg-code) — markers in tg-mk
//   • another host's inline renderer (gd-b / gd-i / gd-code) — markers in gd-mk
// Covered marks: **bold**, *italic*, `code`. (Block-level marks — headings, lists, quotes,
// links, tags, dates, strike, tables — stay in the full editor core; this is the inline-only,
// host-agnostic primitive both bars actually need.)
//
// SECURITY: text content is HTML-escaped here, so a raw, untrusted markdown STRING is safe to
// pass directly. (An earlier host copy required callers to pre-escape — `inlineMd(esc(...))`.
// This module escapes for you, so `renderInlineMd(rawString)` is XSS-safe by itself. Passing
// already-escaped text still works: escaping is idempotent for the entities we emit.)

const ESC_RE = /[&<>]/g;
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

// Escape the HTML-significant chars in text content. Matches editor-core.js `escHtml`
// (& < >). Quotes aren't escaped because content is only ever placed in a text position,
// never inside an attribute value.

// Emit `<span class="<prefix>-mk">…</span>` — the hidden-marker wrapper. `marker` is a literal
// markdown delimiter (`**` / `*` / `` ` ``); it contains no HTML-significant chars, but we
// escape defensively so the contract ("everything that lands in the DOM went through escaping")
// holds unconditionally.
function mk(prefix, marker) {
  return '<span class="' + prefix + '-mk">' + escHtml(marker) + '</span>';
}

// ── The individual marker PASSES, each operating on ALREADY-ESCAPED text ──────────────────────
// These are the raw `.replace()` passes, factored out so a caller that ALREADY escaped (and may
// have injected other markup first — e.g. editor-core.js's highlightLineParts, which wraps block
// markers BEFORE the inline ones, with its strike pass running BETWEEN bold and code) can splice
// them into its own chain and stay BYTE-IDENTICAL. `renderInlineMd` is the escape-then-both-passes
// convenience wrapper most hosts want; these are the parts it's built from.
//
// CONTRACT: input is already HTML-escaped (run escHtml first). They do NOT escape — splicing them
// mid-chain must not double-encode. Pure, DOM-free.

// ── the emphasis tokeniser ──────────────────────────────────────────────────────────────────────
// Emphasis nesting is not a regular language, and `markBoldItalic` above is a regex, so it cannot
// do it: its bold branch is `\*\*[^*\n]+\*\*`, whose content may not contain an asterisk, so a
// nested `*italic*` terminates the match early and the bold is LOST. `**bold with *it* inside**`
// came out entirely italic. CommonMark specifies emphasis as a delimiter-run stack (§6.2, "process
// emphasis"); what follows is that algorithm, restricted to one line and to `*` / `_`.
//
// It produces the same marker–content–marker sandwich as every other mark here, so the round trip
// is unchanged: every delimiter character either lands inside a `<prefix>-mk` span or stays in the
// text as the literal it turned out to be. Nothing is dropped and nothing is invented.

// CommonMark's "Unicode punctuation character" is categories P and S. An edge (undefined) counts as
// whitespace, which is what the spec says about the start and end of a line.
function isMdPunct(c) { return c !== undefined && /[\p{P}\p{S}]/u.test(c); }
function isMdSpace(c) { return c === undefined || /\s/u.test(c); }

const EL_RE = /<(\/?)([a-zA-Z][\w-]*)[^>]*>/y;

// A `<` reaching this pass can only be markup the CALLER injected — escHtml turned every authored
// `<` into `&lt;` — so an element is OPAQUE: the characters inside it are not delimiters. This
// matters immediately: editor-core.js wraps block markers before the inline ones, so an asterisk
// bullet arrives here as `<span class="tg-mk">* </span>rest`, and without this the bullet's own `*`
// would be a candidate opener and could pair with real emphasis further along — emitting a span
// that opens inside the marker and closes outside it, which is not valid nesting.
// Returns the index just past the element, or `i` if this is not a tag at all.
function skipElement(s, i) {
  EL_RE.lastIndex = i;
  const m = EL_RE.exec(s);
  if (!m) return i;
  const openEnd = EL_RE.lastIndex;
  if (m[1]) return openEnd;                       // a stray closing tag — skip it and nothing else
  const tag = m[2].toLowerCase();
  let depth = 1, k = openEnd;
  while (depth > 0) {
    const c = s.indexOf('<', k);
    if (c < 0) return openEnd;                    // unbalanced — only the open tag is opaque
    EL_RE.lastIndex = c;
    const t = EL_RE.exec(s);
    if (!t) { k = c + 1; continue; }
    if (t[2].toLowerCase() === tag) depth += t[1] ? -1 : 1;
    k = EL_RE.lastIndex;
  }
  return k;
}

// The text a reader would see inside a stretch of markup — tags dropped, entities left alone. The
// flanking rules ask what character sits next to a delimiter, and next to an opaque element the
// honest answer is that element's own last (or first) rendered character: a code span ends in a
// backtick, an autolink ends in `>`, a bullet marker ends in a space. Calling every element
// "whitespace" instead was wrong in a way that hid itself — it made `` *a `*`* `` unclosable,
// because a closer preceded by whitespace cannot close, and the emphasis simply never appeared.
function elemText(s, from, to) { return s.slice(from, to).replace(/<[^>]*>/g, ''); }

// Pass 1 — split the text into runs of `*` / `_` and the text between them, deciding for each run
// whether it can open, can close, or both. That verdict comes from the characters on either side
// (the spec's left-flanking / right-flanking), which is why this cannot be done one delimiter at a
// time by a regex: `*` in `a * b` and `*` in `a *b*` are the same character in different company.
function scanRuns(s) {
  const nodes = [];
  let buf = '';
  const flush = () => { if (buf) { nodes.push({ t: 't', v: buf }); buf = ''; } };
  let i = 0, prev;                                // prev === undefined ⇒ an edge, i.e. whitespace
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {                             // an escaped character is never a delimiter, and
      buf += s.slice(i, i + 2);                   // the backslash must survive for markEscapes
      prev = s[i + 1]; i += 2; continue;
    }
    if (c === '<') {
      const end = skipElement(s, i);
      if (end > i) {
        buf += s.slice(i, end);
        const inner = elemText(s, i, end);
        prev = inner ? inner[inner.length - 1] : undefined;
        i = end; continue;
      }
      buf += c; prev = c; i++; continue;
    }
    if (c !== '*' && c !== '_') { buf += c; prev = c; i++; continue; }
    let j = i;
    while (s[j] === c) j++;
    let next = s[j];
    if (next === '<') {
      const end = skipElement(s, j);
      if (end > j) { const inner = elemText(s, j, end); next = inner ? inner[0] : undefined; }
    }
    const beforeSpace = isMdSpace(prev), afterSpace = isMdSpace(next);
    const beforePunct = isMdPunct(prev), afterPunct = isMdPunct(next);
    const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
    const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
    flush();
    nodes.push({
      t: 'd', ch: c, n: j - i, orig: j - i,
      // Asterisks work intraword; underscores do not. That asymmetry is one extra clause here, and
      // it is what keeps `snake_case_name` literal — the rule a live page once lost, growing bare
      // underscores wherever an identifier appeared.
      canOpen: c === '*' ? left : left && (!right || beforePunct),
      canClose: c === '*' ? right : right && (!left || afterPunct),
    });
    prev = c; i = j;
  }
  flush();
  return nodes;
}

// Pass 2 — the spec's "process emphasis". Walk closers left to right; for each, find the nearest
// compatible opener to its left and fold everything between them into one node. Inner pairs are
// reached first, so `**a *b* c**` resolves the italic before the bold gets to it — the whole point.
// Delimiters that end up between a matched pair are never rewound: they are literal text, which is
// also what the spec says.
function processEmphasis(nodes) {
  let ci = 0;
  while (ci < nodes.length) {
    const closer = nodes[ci];
    if (closer.t !== 'd' || !closer.canClose || closer.n === 0) { ci++; continue; }
    let oi = -1;
    for (let k = ci - 1; k >= 0; k--) {
      const o = nodes[k];
      if (o.t !== 'd' || o.n === 0 || o.ch !== closer.ch || !o.canOpen) continue;
      // The spec's "rule of 3": when either side of the pair could play both parts, a match whose
      // combined ORIGINAL run lengths is a multiple of 3 is refused — unless both lengths are. It
      // reads like numerology and is not: it is what makes `*a**b**c*` an italic containing a bold
      // rather than the other way round.
      if ((closer.canOpen || o.canClose) && (closer.orig + o.orig) % 3 === 0 &&
          !(closer.orig % 3 === 0 && o.orig % 3 === 0)) continue;
      oi = k; break;
    }
    if (oi < 0) { ci++; continue; }
    const opener = nodes[oi];
    const use = (closer.n >= 2 && opener.n >= 2) ? 2 : 1;   // two delimiters is strong, one is em
    const kids = nodes.slice(oi + 1, ci);
    opener.n -= use; closer.n -= use;
    nodes.splice(oi + 1, ci - oi - 1, { t: 'e', use: use, mark: closer.ch.repeat(use), kids: kids });
    ci = oi + 2;                                  // the closer moved here; it may still have length
  }
}

// Pass 3 — serialize. A delimiter that never matched prints the characters it is made of, so the
// text comes back byte-for-byte: every character is either inside a marker span or still itself.
function renderNodes(nodes, p) {
  let out = '';
  for (const n of nodes) {
    if (n.t === 't') out += n.v;
    else if (n.t === 'd') out += n.n ? n.ch.repeat(n.n) : '';
    else out += '<span class="' + p + (n.use === 2 ? '-b' : '-i') + '">' +
                mk(p, n.mark) + renderNodes(n.kids, p) + mk(p, n.mark) + '</span>';
  }
  return out;
}

// **bold** / *italic* / __bold__ / _italic_ over escaped text, nesting correctly.
//
// Asterisks work intraword; underscores follow CommonMark's intraword rule (an opening or closing
// `_` may not sit between two alphanumerics), so `snake_case`, `file_name` and `a_b_c` stay literal.
// A backslash-escaped delimiter is not a delimiter at all — the scanner consumes `\*` as one unit —
// which also settles a case the old regex had to guess at: `\\*a*` is an escaped BACKSLASH followed
// by real emphasis, and it now emphasises, because the scanner counts backslashes instead of
// peering behind one.
function markEmphasis(escaped, prefix) {
  const s = String(escaped);
  if (s.indexOf('*') < 0 && s.indexOf('_') < 0) return s;   // most lines; skip the whole machine
  const nodes = scanRuns(s);
  processEmphasis(nodes);
  return renderNodes(nodes, prefix || 'tg');
}

// The name this primitive shipped under, kept because consumers outside this repo import it. New
// callers should use markEmphasis; this is the same function, not an older one.
function markBoldItalic(escaped, prefix) { return markEmphasis(escaped, prefix); }

// `code` over escaped text — single backticks, no newline inside.
function markCode(escaped, prefix) {
  const p = prefix || 'tg';
  // Same escape rule as the emphasis pass: `\`` is a literal backtick, not the start of a code span.
  return String(escaped).replace(/((?<!\\)`[^`\n]+`)/g, (m) => {
    const inner = m.slice(1, -1);
    return '<span class="' + p + '-code">' + mk(p, '`') + inner + mk(p, '`') + '</span>';
  });
}

// Render an INLINE markdown string into HTML with markers wrapped in hidden `*-mk` spans and
// content wrapped in effect spans. Pure, DOM-free, zero-dependency.
//
//   renderInlineMd(text, { prefix = 'tg' } = {})  →  HTML string
//
//   text    raw inline markdown (a single line / fragment). HTML-escaped internally → XSS-safe.
//   prefix  class namespace, default 'tg'. tile → 'tg', another host → 'gd', preview → 'gp'.
//
// Behaviour (faithful to editor-core.js highlightLineParts inline marks):
//   **bold**   → <span class="<p>-b"><span class="<p>-mk">**</span>bold<span class="<p>-mk">**</span></span>
//   *italic*   → <span class="<p>-i">…*…italic…*…</span>   (single * needs a non-space after it,
//                                                            so "a * b" is NOT italicised)
//   `code`     → <span class="<p>-code">…`…code…`…</span>
//   **bold** wins the alternation over *italic*; `code` is a separate pass. Content INSIDE the
//   marks is plain text (escaped) — no nested re-parsing, matching the source renderers exactly.
// The backslash of an escape is syntax, so it hides like every other marker — `\*` shows as `*`
// while the text still round-trips with the backslash in it.
//
// Runs LAST, after the emphasis and code passes, for a reason: those passes must still see the
// backslash in order to decline. Reversing the order would hide the backslash and then emphasise the
// text it was protecting, which is the bug with an extra step.
//
// Only the characters CommonMark says are escapable, so `C:\path` and `\n` in prose are left alone.
// 🔴 NOT inside a code span. CommonMark does not run backslash escapes there — a code span's content
// is literal — so `` `/^- \[(.)\]/` `` must keep its backslashes VISIBLE. This pass runs last and
// over the whole string, so without the skip it reached inside the span markCode had just built and
// hid characters that are part of the code. Found by rendering 168 of the owner's own documents with
// the old module and the new one and diffing: 270 lines moved, and this was the only one of them
// that moved the wrong way.
//
// markCode runs BEFORE this, so the span already exists and skipping it is a split, not a parse.
// Known and not fixed: an <autolink>'s URL is literal in the same way, but that span is built in
// editor-core and shares its class with ordinary links, whose text IS prose and must keep escaping.
// A backslash inside an autolink URL is rare enough to name rather than chase.
function markEscapes(escaped, prefix) {
  const p = prefix || 'tg';
  const s = String(escaped);
  const open = '<span class="' + p + '-code">';
  const sub = (t) => t.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, (m, ch) => mk(p, '\\') + ch);
  let out = '', i = 0;
  for (;;) {
    const j = s.indexOf(open, i);
    if (j < 0) return out + sub(s.slice(i));
    const end = skipElement(s, j);        // balanced: the span holds two nested marker spans
    const stop = end > j ? end : j + open.length;
    out += sub(s.slice(i, j)) + s.slice(j, stop);
    i = stop;
  }
}

function renderInlineMd(text, opts) {
  const prefix = (opts && opts.prefix) || 'tg';
  // Escape FIRST (whole string), then run the marker passes over escaped text — same order as
  // editor-core.js (escHtml(line).replace(...)). The markers **, *, ` are unaffected by escaping.
  //
  // CODE BEFORE EMPHASIS, which is the spec's precedence and was the other way round until
  // 2026-08-04: a code span's content is literal by definition, so `` `*` `` is an asterisk and not
  // a delimiter. Running emphasis first made ``*a `*`*`` pair the backtick's asterisk with the outer
  // one, and made `` `**a**` `` — documenting the syntax, which this repo does constantly — render
  // as bold inside the code span. markEmphasis treats the finished code span as opaque, so the
  // reorder is all the fix needs.
  return markEscapes(markEmphasis(markCode(escHtml(text), prefix), prefix), prefix);
}

// The CSS contract. Returns the stylesheet text a host must include for the technique to work:
//   • `.<prefix>-mk{display:none}` — HIDES the raw markers (the whole point).
//   • `.<prefix>-b{font-weight:700}` / `.<prefix>-i{font-style:italic}` — the bold/italic effects.
//   • `.<prefix>-code{…}` — monospace inline code. Colours are intentionally LEFT to the host
//     (another host tints code teal, marktile uses its own accent); this primitive ships only
//     the structural rules so consumers stay in control of their palette. Pass
//     `{ scope: '.gd-answer' }` to prefix every selector (e.g. only hide markers inside answers),
//     mirroring another host's `.gd-answer .gd-mk{display:none}`.
function cssContract(opts) {
  const prefix = (opts && opts.prefix) || 'tg';
  const scope = (opts && opts.scope) ? opts.scope + ' ' : '';
  return (
    scope + '.' + prefix + '-mk{display:none}' +
    scope + '.' + prefix + '-b{font-weight:700}' +
    scope + '.' + prefix + '-i{font-style:italic}' +
    scope + '.' + prefix + '-code{font-family:ui-monospace,Menlo,monospace;font-size:0.92em;border-radius:3px;padding:0 3px}'
  );
}


// Synchronized syntax highlighter: renders raw markdown styling (bold, headings, lists, blockquotes, tags, links, dates).
// Modifies only font weights and colors (maintains font size) to match the textarea line-height, ensuring perfect layout alignment (crucial for this design).
// Highlights ONE markdown line into { cls, inner } for a <div class="tg-line"> block. Markers are KEPT
// (literal '## ' stays visible); heading lines just carry a level class so CSS can size them up. An empty
// line uses <br> (textContent '') so the text<->DOM round-trip stays exact. Shared by the full render and
// the in-place single-line re-highlight (so both produce byte-identical DOM).
function highlightLineParts(line, block) {
  // Inside a fenced code block or the frontmatter, the line is NOT markdown, and the only honest
  // rendering of it is the characters themselves. `block` is the verdict from blockScan(), which is
  // the only thing that can know — a fence's extent is a fact about the SEQUENCE of lines, and this
  // function sees one. Without it `**not bold**` inside a ```js fence came out bold and
  // `[[not a link]]` came out as a link, on every surface including the shipped Obsidian plugin.
  if (block === 'cblock' || block === 'cfence' || block === 'fm' || block === 'fmfence') {
    return { cls: 'tg-line tg-' + block, inner: (escHtml(line) || '<br>') };
  }
  // A setext underline is pure syntax, like a thematic break: the whole line is the marker.
  if (block === 'srule') return { cls: 'tg-line tg-srule', inner: '<span class="tg-mk">' + escHtml(line) + '</span>' };
  let cls = 'tg-line';
  // …but the heading TEXT is ordinary prose that happens to be a heading, so it keeps every inline
  // mark and merely gains the level class the # form would have given it.
  if (block === 'sh1' || block === 'sh2') cls += ' tg-h tg-h' + block.slice(2);
  // 🔴 STRUCTURAL WHITESPACE IS `[ \t]`, NEVER `\s`. CommonMark's block markers are defined in terms
  // of spaces and tabs; JS `\s` is far wider, and the one that matters is U+00A0 NO-BREAK SPACE,
  // which arrives constantly in text pasted from the web, Word or Pages. With `\s` this engine read
  // `-<NBSP>item` as a bullet, wrapped the marker in a tg-mk span, and Rendered then HID a character
  // the author had actually typed — while every other tool renders that line as a paragraph.
  // Verified against the reference `commonmark` package: NBSP after `-`, `1.`, `#`, or before the
  // end of a `---` all mean "not that construct". `>` is the exception below, because the `>` IS the
  // marker and the space after it is optional.
  //
  // CommonMark: a heading counts at line start, after ≤3 leading spaces, OR inside a list item. hm[1] swallows the
  // optional indent + bullet/checkbox prefix so `- ### x` / `- [ ] ### x` / `  ### x` all size+colour as headings;
  // hm[2] is the # run (→ level). It's ADDITIVE with tg-li/tg-task — a heading can also be a list/task line.
  const hm = /^([ \t]*(?:[-*][ \t](?:\[[ xX]\][ \t])?)?)(#{1,6})[ \t]/.exec(line);
  if (hm) cls += ' tg-h tg-h' + hm[2].length;
  if (/^>[ \t]?/.test(line)) cls += ' tg-quote';
  else if (/^[ \t]*[-*][ \t]/.test(line)) cls += ' tg-li';
  else if (/^[ \t]*\d+[.)][ \t]/.test(line)) cls += ' tg-ol';   // ordered list — 43635 occurrences in his corpus, the most common construct in it, and until now the only list kind with a toolbar button and no rendering
  // A thematic break is the whole line. Frontmatter never reaches here (blockScan labels it first), so a
  // `---` that gets this far is the horizontal rule it looks like.
  if (/^(-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line)) cls += ' tg-hr';
  // A link reference or footnote definition — `[ref]: https://…`. It is a line that produces no visible
  // output in a rendered document, so Rendered dims it rather than pretending it is a paragraph.
  if (/^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*\S/.test(line)) cls += ' tg-refdef';
  // Two trailing spaces before a newline is a hard break — invisible syntax, which is exactly the kind
  // a person deletes by accident. Marked so Rendered can show it as the line break it is.
  if (/\S {2,}$/.test(line)) cls += ' tg-brk';
  // Each syntax marker (## , &gt; , - , [ ], **, *, ~~, `, [[ ]], @{}) is wrapped in its own <span class="tg-mk">
  // so a host can hide JUST the markers via CSS (.tugtile-preview .tg-mk{display:none}) while the styling stays —
  // the basis for a marker-free preview look. tg-mk is transparent to the text round-trip (getText reads
  // textContent, which still includes the marker chars). The Obsidian plugins never add .tugtile-preview, so
  // markers stay visible there (their 調味/原味 cycle is unchanged); only a host that opts in hides them. escHtml
  // has already turned a leading > into &gt; (the quote marker), so match that form.
  // Block-level markers first (headings / quote / checkbox / bullet — these STAY in the core;
  // they're line-anchored and outside cssmd's inline-only scope).
  const blocks = escHtml(line)
    .replace(/^([ \t]*(?:[-*][ \t](?:\[[ xX]\][ \t])?)?)(#{1,6}[ \t])/, (m, pre, hashes) => pre + '<span class="tg-mk">' + hashes + '</span>')   // heading marker — wraps only the # run, leaving any indent/bullet/checkbox prefix for the rules below to wrap
    .replace(/^(&gt;[ \t]?)/, '<span class="tg-mk">$1</span>')   // blockquote marker
    // The checkbox needs whitespace (or the line end) AFTER it too — GFM asks for at least one
    // whitespace character, so `- [ ]<NBSP>task` is an ordinary bullet whose text happens to begin
    // with `[ ]`, not a task. Same reason as every other marker here.
    .replace(/^([ \t]*[-*][ \t])(\[[ xX]\])(?=[ \t]|$)/, (m, p, box) => '<span class="tg-mk">' + p + '</span><span class="tg-check' + (/[xX]/.test(box) ? ' tg-check-done' : '') + '"><span class="tg-mk">' + box + '</span></span>')
    .replace(/^([ \t]*[-*][ \t])/, '<span class="tg-mk">$1</span>')   // plain bullet (heading/quote/checkbox lines already start with a <span>, so this won't match them)
    // The ordered marker is tg-num, NOT tg-mk: `1. ` is not punctuation the reader can spare — the number
    // is the content. A bullet's `- ` can be swapped for a • because the dot carries the same meaning;
    // hiding "7." and drawing a dot would delete the seventh-ness.
    .replace(/^([ \t]*\d+[.)][ \t])/, '<span class="tg-num">$1</span>')
    // A thematic break IS its marker, so the whole line hides in Rendered and CSS draws the rule.
    .replace(/^((?:-{3,}|\*{3,}|_{3,})[ \t]*)$/, '<span class="tg-mk">$1</span>');
  // PRECEDENCE. Two constructs bind tighter than emphasis and go first, because their content is
  // addressing or literal text rather than prose: an inline `code` span and an <autolink>. Both are
  // DELEGATED-or-local marker sandwiches, and markEmphasis treats a finished span as OPAQUE, so
  // running them first is the whole mechanism — `` `*` `` stops being a delimiter, and the `**` in
  // `**a<https://x/?q=**>` stops finding a partner. This was the other way round until 2026-08-04,
  // which is why `` `**a**` `` used to render bold inside the code span.
  const tight = markCode(blocks, 'tg')
    // <https://…> and <a@b.c> — a bare URL in angle brackets, which is the one HTML-looking thing in
    // markdown that is not HTML. escHtml has already turned the brackets into entities.
    .replace(/&lt;((?:[a-z][a-z0-9+.-]*:|mailto:)[^\s&]*|[^\s&@]+@[^\s&@]+\.[^\s&@]+)&gt;/gi, (m, url) =>
      '<span class="tg-link"><span class="tg-mk">&lt;</span>' + url + '<span class="tg-mk">&gt;</span></span>');
  // Inline **bold** / *italic* — DELEGATED to the shared cssmd primitive (markEmphasis), the single
  // source for this mark. Runs over the already-escaped, block-marked, code-marked text; the
  // tokeniser treats an already-injected span as OPAQUE, so an asterisk bullet's own `*` can never
  // pair with real emphasis further along the line. tg-* prefix keeps the plugins' class names.
  //
  // The LINK passes stay AFTER this, deliberately, even though the spec binds link brackets tighter
  // than emphasis too: a link's TEXT is prose and routinely contains emphasis (`[*bar*](/url)`), and
  // an opaque link span would lose it. The price is the spec's own edge case `*[bar*](/url)`, where
  // the brackets should stop a pair from forming — rare enough to be worth the trade, and named here
  // rather than left as a surprise.
  const h = markEmphasis(tight, 'tg')
    .replace(/(~~[^~\n]+~~)/g, (m) => '<span class="tg-strike"><span class="tg-mk">~~</span>' + m.slice(2, -2) + '<span class="tg-mk">~~</span></span>')
    .replace(/(\[\[[^\]\n]+\]\])/g, (m) => '<span class="tg-link"><span class="tg-mk">[[</span>' + m.slice(2, -2) + '<span class="tg-mk">]]</span></span>')
    // CommonMark's own link and image. The engine grew up inside Obsidian and learned the dialect
    // ([[wikilink]]) before the language — `[text](url)` appears in 32.7% of his documents and rendered
    // as raw punctuation in every one of them. Images run FIRST so the leading `!` joins the marker
    // rather than being left stranded outside the span.
    // Both are a marker–text–marker sandwich exactly like the wikilink above, so Rendered's existing
    // "hide .tg-mk" rule shows the label alone with no new CSS. The URL travels inside a marker: it is
    // addressing, not prose. Runs AFTER [[ ]] so a wikilink is never half-eaten.
    .replace(/(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g, (m, bang, text, url) =>
      '<span class="tg-' + (bang ? 'img' : 'link') + '"><span class="tg-mk">' + bang + '[</span>' +
      text + '<span class="tg-mk">](' + url + ')</span></span>')
    // Reference links and footnotes: [text][ref], the bare [ref] form, [^1], and the definition lines
    // that give them their targets. All four are marker-and-label like every other link here; what this
    // does NOT do is resolve one to the other, which needs a document-wide map and is a different job.
    // The label is still styled, which is the part a reader is looking for.
    .replace(/(\[)(\^[^\]\n]+)(\])/g, (m, o, ref, c) => '<span class="tg-ref"><span class="tg-mk">' + o + '</span>' + ref + '<span class="tg-mk">' + c + '</span></span>')
    .replace(/(\[)([^\]\n]*)(\]\[)([^\]\n]*)(\])/g, (m, o, text, mid, ref, c) =>
      '<span class="tg-ref"><span class="tg-mk">' + o + '</span>' + text + '<span class="tg-mk">' + mid + ref + c + '</span></span>')
    // (the <autolink> pass moved ABOVE markEmphasis — see the precedence note there)
    .replace(/(@@?\{)([^}\n]*)(\})/g, (m, op, inner, cl) => '<span class="tg-date"><span class="tg-mk">' + op + '</span>' + inner + '<span class="tg-mk">' + cl + '</span></span>')
    .replace(/(^|[^&\w])(#[^\s#<&]+)/g, '$1<span class="tg-tag">$2</span>')
    .replace(/\t/g, '<span class="tg-tab">\t</span>');   // wrap each literal tab LAST (after the line-start regexes) so CSS can mark tab-vs-space; span is transparent to the text round-trip
  // Escapes hide LAST of all — every pass above has to still see the backslash in order to decline.
  const esc = markEscapes(h, 'tg');
  if (/^[ \t]*[-*][ \t]\[[ xX]\](?=[ \t]|$)/.test(line)) cls += ' tg-task' + (/^[ \t]*[-*][ \t]\[[xX]\](?=[ \t]|$)/.test(line) ? ' tg-task-done' : '');
  return { cls: cls, inner: (esc || '<br>') };
}
// Which lines are inside a block that is not markdown. Pure (text in, one label per line out) so it is
// unit-testable without a DOM, and so the single-line re-highlight can ask the same question the full
// render asks. Labels: 'cfence'/'cblock' for ``` blocks, 'fmfence'/'fm' for YAML frontmatter, null
// otherwise. NOT 'code' — .tg-code is already the INLINE `code` span, and one class meaning two things is
// how a stylesheet starts lying.
//
// Frontmatter is only frontmatter at the very top of the file — a `---` anywhere else is a thematic
// break, and treating one as the other would swallow the rest of the document.
const FENCE = /^([ \t]{0,3})(`{3,}|~{3,})(.*)$/;
function blockScan(lines) {
  const kind = new Array(lines.length).fill(null);
  let i = 0;
  if (lines.length > 1 && /^---[ \t]*$/.test(lines[0])) {
    for (let j = 1; j < lines.length; j++) {
      if (/^(---|\.\.\.)[ \t]*$/.test(lines[j])) {
        kind[0] = kind[j] = 'fmfence';
        for (let k = 1; k < j; k++) kind[k] = 'fm';
        i = j + 1;
        break;
      }
    }
  }
  let open = null;   // the character the open fence used; CommonMark closes only with the same one
  // Indented code needs two more facts, and both are about what came BEFORE:
  //   · it cannot interrupt a paragraph — four spaces under a line of prose is a wrapped sentence,
  //     which is how people actually type, not a code block;
  //   · inside a list, four spaces is the list's own continuation indent, not code. `listIndent` is
  //     how deep the open item's content sits, so code there starts at listIndent + 4.
  // Getting the second one wrong would paint real notes grey, so it is tracked rather than guessed.
  const width = (s) => { let n = 0; for (const c of s) n += c === '\t' ? 4 - (n % 4) : 1; return n; };
  let blank = true, listIndent = -1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const m = FENCE.exec(line);
    if (open !== null) {
      if (m && m[2][0] === open.ch && m[2].length >= open.len && !m[3].trim()) { kind[i] = 'cfence'; open = null; }
      else kind[i] = 'cblock';
      continue;
    }
    if (m) { kind[i] = 'cfence'; open = { ch: m[2][0], len: m[2].length }; blank = false; continue; }

    const indent = width(line.match(/^[ \t]*/)[0]);
    const empty = !line.trim();
    const item = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]/.exec(line);
    if (empty) { blank = true; continue; }              // a blank line does not close a list
    if (item) {
      listIndent = width(item[0]);                      // content of the item starts here
    } else if (listIndent >= 0 && indent < listIndent && indent < 4) {
      listIndent = -1;                                  // dedented back out of the list
    }
    const floor = (listIndent >= 0 ? listIndent : 0) + 4;
    if (blank && indent >= floor) kind[i] = 'cblock';   // only after a blank line: never interrupts a paragraph
    else blank = false;
  }
  // Setext headings, last, because they are the one construct that reads BACKWARDS: the underline
  // says what the line above it was. This is also why `---` is genuinely ambiguous in markdown and
  // not by accident — the language absorbed two heading syntaxes, and the underline character of one
  // collides with the thematic break of the other. A line-at-a-time highlighter cannot resolve that;
  // here the whole sequence is in hand, so it can.
  //
  // The heading is the WHOLE preceding paragraph, not just the last line, which is why this walks
  // back. A `-` underline loses to nothing: with a paragraph above it, CommonMark says heading, and
  // the thematic break it would otherwise have been never happens.
  const UNDER = /^[ \t]{0,3}(=+|-+)[ \t]*$/;
  const OPENER = /^[ \t]{0,3}(?:[-*+>][ \t]|#{1,6}[ \t]|\d{1,9}[.)][ \t]|\|)/;
  for (let j = 1; j < lines.length; j++) {
    if (kind[j] !== null) continue;
    const u = UNDER.exec(lines[j]);
    if (!u) continue;
    let k = j - 1;
    if (k < 0 || kind[k] !== null || !lines[k].trim() || OPENER.test(lines[k])) continue;
    const level = u[1][0] === '=' ? 'sh1' : 'sh2';
    while (k >= 0 && kind[k] === null && lines[k].trim() && !OPENER.test(lines[k]) && !UNDER.test(lines[k])) {
      kind[k] = level;
      k--;
    }
    kind[j] = 'srule';
  }
  return kind;   // an unclosed fence runs to the end of the document, as CommonMark says it does
}

// Renders the whole markdown source into per-line <div> blocks for the contenteditable editor.
function highlightMarkdown(text) {
  const lines = (text === '' ? [''] : text.split('\n'));
  const kind = blockScan(lines);
  return lines.map((line, i) => { const p = highlightLineParts(line, kind[i]); return '<div class="' + p.cls + '">' + p.inner + '</div>'; }).join('');
}

// Smart-Enter list continuation (pure, so it's unit-testable without a DOM). Given the full text and a caret
// offset, returns the new { text, caret } when the caret line is a list item (- / * / 1. / - [ ]), or null
// when it isn't (so the caller lets the native newline happen). A list item that's empty past its marker
// exits the list (marker removed). Ordered markers increment; checkbox items continue UNCHECKED.
function listContinuation(v, s) {
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  let le = v.indexOf('\n', s); if (le < 0) le = v.length;
  const line = v.slice(ls, le);
  let prefix = null, contentStart = 0;
  const mu = /^([ \t]*)([-*])[ \t]+(\[[ xX]\][ \t]+)?/.exec(line);
  if (mu) { contentStart = mu[0].length; prefix = mu[1] + mu[2] + ' ' + (mu[3] ? '[ ] ' : ''); }
  else { const mo = /^([ \t]*)(\d+)([.)])[ \t]+/.exec(line); if (mo) { contentStart = mo[0].length; prefix = mo[1] + (parseInt(mo[2], 10) + 1) + mo[3] + ' '; } }
  if (prefix === null) return null;
  if (line.slice(contentStart).trim() === '') return { text: v.slice(0, ls) + v.slice(le), caret: ls };   // empty item → exit the list
  return { text: v.slice(0, s) + '\n' + prefix + v.slice(s), caret: s + 1 + prefix.length };               // continue the list
}

// The list markers are ONE FAMILY, not four independent prefixes. Pure (unit-tested), so the toolbar's
// bullet / number / check buttons SWITCH between them instead of stacking one on top of another.
// Returns { indent, kind, bullet, len } for the marker at the head of a line, or null when there is none.
// `len` is how many characters the whole marker (indent included) occupies, so callers can slice it off.
function listMarker(line) {
  const m = /^([ \t]*)(?:([-*+])[ \t]+(\[[ xX]\][ \t]+)?|(\d+)([.)])[ \t]+)/.exec(String(line));
  if (!m) return null;
  if (m[2]) return { indent: m[1], kind: m[3] ? 'check' : 'bullet', bullet: m[2], len: m[0].length };
  return { indent: m[1], kind: 'number', bullet: '-', len: m[0].length };
}

// Apply one list kind ('bullet' | 'number' | 'check') to the lines the selection touches — REPLACING whatever
// marker is already there rather than prepending to it. Toggles OFF (marker removed, indentation kept) when
// every non-blank line already carries the requested kind. Blank lines are left alone; 'number' renumbers the
// block 1..N. A line's existing bullet character is preserved when switching bullet ↔ check, so a '*' list
// stays a '*' list. Quote ('> ') is deliberately NOT part of this family — it nests with lists, it doesn't
// replace them. Pure: returns { text, start, end } (start === end when the caller had a bare caret).
function setListKind(v, s, e, kind) {
  const src = String(v);
  const lineStart = (pos) => src.lastIndexOf('\n', pos - 1) + 1;
  const firstLs = lineStart(s);
  const lastLs = lineStart(e > s ? e - 1 : s);
  const nlAfter = src.indexOf('\n', lastLs), blockEnd = nlAfter === -1 ? src.length : nlAfter;
  const lines = src.slice(firstLs, blockEnd).split('\n');
  const nonBlank = lines.filter((ln) => ln.trim() !== '');
  const allHave = nonBlank.length > 0 && nonBlank.every((ln) => { const mk = listMarker(ln); return mk && mk.kind === kind; });
  let n = 0;
  const out = lines.map((ln) => {
    if (ln.trim() === '') return ln;
    const mk = listMarker(ln);
    const indent = mk ? mk.indent : (/^[ \t]*/.exec(ln)[0]);
    const body = ln.slice(mk ? mk.len : indent.length);
    if (allHave) return indent + body;                                  // every non-blank has it → strip, keep the indent
    if (kind === 'number') { n++; return indent + n + '. ' + body; }
    const ch = (mk && mk.bullet) || '-';                                 // keep the author's bullet character
    return indent + ch + (kind === 'check' ? ' [ ] ' : ' ') + body;
  }).join('\n');
  const text = src.slice(0, firstLs) + out + src.slice(blockEnd);
  if (s !== e) return { text, start: firstLs, end: firstLs + out.length };
  const delta = out.split('\n')[0].length - lines[0].length;             // caret rides the first line's width change
  return { text, start: Math.max(firstLs, s + delta), end: Math.max(firstLs, s + delta) };
}

// Removing formatting can EXPOSE formatting. A real line from the corpus, "3. **>25MB → ...**", loses its
// list marker and its bold and is then left starting with '>' — which is a blockquote. The text now says
// something it did not say before, and running the same command again eats the '>' entirely: not idempotent,
// and character-destroying. So a marker that ends up at the head of the line gets escaped. The digit of an
// ordered marker is NOT escapable in CommonMark ("\\1" is a literal backslash-one), so 1. escapes as "1\\." —
// the delimiter, not the number.
function escapeLeadingMarker(s) {
  const mo = /^([ \t]*)(\d+)([.)])([ \t])/.exec(s);
  if (mo) return mo[1] + mo[2] + '\\' + s.slice(mo[1].length + mo[2].length);
  if (/^[ \t]*(?:>|#{1,6}[ \t]|[-*+][ \t])/.test(s)) return s.replace(/^([ \t]*)/, '$1\\');
  return s;
}

// Strip markdown down to plain text. Pure → unit-tested. Two decisions worth stating, because both are the
// kind of thing that looks like an oversight from the outside:
//   · IMAGES SURVIVE. ![alt](url) and ![[pic.png]] are CONTENT, not formatting — flattening an image to the
//     word "alt" deletes something the writer cannot get back with undo-after-save. Links are the opposite:
//     the text was always the content, the URL was the decoration, so [text](url) → text.
//   · FENCED CODE SURVIVES, minus its fences. The whole point of a code block is that its contents are literal;
//     un-escaping a `*` inside one would change what the code says.
// Tables are left entirely alone — "plain text" has no agreed meaning for a grid, and silently flattening one
// would lose the columns. Use the table's own tools for those.
function stripFormatting(md) {
  const IMG = /!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g;
  const inline = (s) => {
    const held = [];
    const keep = (text) => '\u0000' + (held.push(text) - 1) + '\u0000';   // NUL-fenced, so no real text can collide
    let t = s.replace(IMG, keep);                       // images survive whole
    // Inline code loses its backticks but its CONTENTS are held out of every rule below. Without this, a real
    // line from the corpus — rg -g '!Conversations/**' -g '!Imported/**' -g '!Soul/me/.git/**' — had the `**`
    // between two of its globs read as bold and DELETED, silently changing what the command does. Fenced code
    // was already protected; a one-line code span is the same promise and had none of the protection.
    t = t.replace(/`([^`]*)`/g, (m, code) => keep(code));
    // .+? rather than [^\]]*: a wikilink's text may itself contain a ']' — [[[handoff → x] note]] is in the
    // corpus — and the character class stopped at the inner bracket, leaving the '[[' on screen.
    t = t.replace(/\[\[([^\][|]+)\|(.+?)\]\]/g, '$2');   // [[page|alias]] → the alias, which is what was read
    t = t.replace(/\[\[(.+?)\]\]/g, '$1');
    t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    t = t.replace(/~~([\s\S]*?)~~/g, '$1');
    t = t.replace(/==([\s\S]*?)==/g, '$1');
    t = t.replace(/\*\*([\s\S]*?)\*\*/g, '$1');
    t = t.replace(/__([\s\S]*?)__/g, '$1');
    t = t.replace(/\*([^*\n]+)\*/g, '$1');
    t = t.replace(/(^|[^\w\\])_([^_\n]+)_(?=$|[^\w])/g, '$1$2');   // NOT intraword: snake_case_names stay whole
    return t.replace(/\u0000(\d+)\u0000/g, (m, i) => held[+i]);
  };
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let fence = false;
  for (const raw of lines) {
    if (/^[ \t]*(```|~~~)/.test(raw)) { fence = !fence; continue; }   // drop the fence lines, keep what they hold
    if (fence) { out.push(raw); continue; }
    if (isTableLine(raw)) { out.push(raw); continue; }
    let ln = raw.replace(/^[ \t]*(?:>[ \t]?)+/, '').replace(/^[ \t]*#{1,6}[ \t]+/, '');
    const mk = listMarker(ln);
    if (mk) ln = ln.slice(mk.len);   // the indent goes with the marker — a de-listed line is not an item any more
    out.push(escapeLeadingMarker(inline(ln)));
  }
  return out.join('\n');
}

// Re-sequence contiguous top-level ordered-list blocks so they read 1,2,3… A markdown renderer renumbers
// regardless of the literal digits, but marktile SHOWS the markers — so deleting "2." should make the old
// "3." become "2.". Pure (unit-testable) and, for single-digit lists, caret-stable (a renumbered marker is
// the same width). A blank or non-ordered line ends a block; indented/nested ordered lists are left alone.
// Returns the SAME string when already sequential, so callers can no-op on identity (the common case).
function renumberLists(v) {
  const lines = v.split('\n');
  let n = 0, changed = false;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\d+)([.)])([ \t])/.exec(lines[i]);
    if (m) { n++; const want = n + m[2] + m[3]; if (m[0] !== want) { lines[i] = want + lines[i].slice(m[0].length); changed = true; } }
    else if (/^[ \t]+\S/.test(lines[i])) continue;   // indented continuation / nested list → part of the current item, leave the top-level counter alone
    else n = 0;   // blank / non-indented non-ordered line breaks the block → next ordered run restarts at 1
  }
  return changed ? lines.join('\n') : v;
}

// Tab inserts a literal tab at the caret (replacing any selection); Shift+Tab removes one tab immediately
// before a collapsed caret. Tugtile's tile structure is tab-indented (serializeTile re-adds it on write),
// so being able to type a real tab matters when editing a raw board file in marktile. Pure → unit-tested.
function tabEdit(v, s, e, outdent) {
  if (outdent) {
    if (s === e && s > 0 && v[s - 1] === '\t') return { text: v.slice(0, s - 1) + v.slice(s), caret: s - 1 };
    return null;   // nothing to outdent
  }
  return { text: v.slice(0, s) + '\t' + v.slice(e), caret: s + 1 };
}

// Table-of-contents model (pure → unit-tested). Scans markdown for H1–H3 headings OUTSIDE fenced code blocks,
// returning { level, text, line } per heading. `line` is the 0-based source line index, which maps 1:1 to the
// editor's .tg-line divs (highlightMarkdown emits one div per line) so the consumer can scroll straight to it.
function tocHeadings(text) {
  const lines = String(text).split('\n');
  const out = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^[ \t]*(```|~~~)/.test(lines[i])) { fence = !fence; continue; }   // a fence line toggles in/out of code (its own # are not headings)
    if (fence) continue;
    const m = /^(#{1,3})[ \t]+(.*)$/.exec(lines[i]);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i });
  }
  return out;
}

// Drag-reorder a TOC section (pure → unit-tested). oldIndex/newIndex are heading positions in tocHeadings()
// order (= SortableJS evt.oldIndex/newIndex). A "section" = the heading line through everything up to the next
// heading of EQUAL-OR-HIGHER level (so dragging an H1 carries its H2/H3 children; level B: levels never change).
// Moving down lands it after the target's whole section; moving up lands it before the target.
function moveSection(text, oldIndex, newIndex) {
  if (oldIndex === newIndex) return text;
  const lines = String(text).split('\n');
  const heads = tocHeadings(text);
  const n = heads.length;
  if (oldIndex < 0 || oldIndex >= n || newIndex < 0 || newIndex >= n) return text;
  const sectionEnd = (idx) => { const lv = heads[idx].level; for (let j = idx + 1; j < n; j++) if (heads[j].level <= lv) return heads[j].line; return lines.length; };
  const start = heads[oldIndex].line, end = sectionEnd(oldIndex);
  const block = lines.slice(start, end);
  const insertAt = (newIndex > oldIndex) ? sectionEnd(newIndex) : heads[newIndex].line;   // after target's section (down) / before target (up)
  const rest = lines.slice(0, start).concat(lines.slice(end));
  const ins = (insertAt >= end) ? insertAt - block.length : insertAt;   // shift left if the removed block sat before the insertion point
  return rest.slice(0, ins).concat(block, rest.slice(ins)).join('\n');
}

// Builds the reusable contenteditable editor into a container; returns a controller. Hosted by the modal
// (kanban cards) and by marktile's file view (standalone .md). opts: { text, onCancel?, onSave?,
// onSubmit?, onEscape?, onChange? }. host = the board view or a minimal file host (see interface above).
function mountEditor(contentEl, opts, host) {
  const orig = opts.text || '';
    contentEl.empty(); contentEl.addClass('tugtile-edit-modal');

    // Title bar: Cancel (✕) on the left, tool actions in the center, Save (✓) on the right (positioned at the top to avoid virtual keyboard occlusion)
    const bar = contentEl.createDiv({ cls: 'tugtile-ed-bar' });
    // Virtual keyboard workaround: call preventDefault on mousedown/pointerdown to block focus transfer.
    // This keeps the keyboard open, prevents viewport reflows, and ensures the tap action is registered properly.
    // The textarea retains focus and values during execution before closing. This technique is verified and reused in tbtn shortcut buttons.
    const tap = (el, fn) => {
      el.addEventListener('mousedown', (e) => e.preventDefault());                                  // Prevents stealing focus from the textarea (mouse/synthetic events)
      el.addEventListener('pointerdown', (e) => e.preventDefault());                                // Touch/stylus: same as above (blocks focus transfer only, allows scrolling)
      el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });  // Touch: triggers immediately + retains focus + blocks synthetic click
      el.addEventListener('click', fn);                                                             // Mouse/desktop click
    };
    if (opts.onToc) { const tc = bar.createEl('button', { cls: 'tugtile-iconbtn tugtile-ed-toc' }); setIcon(tc.createSpan(), 'list-tree'); tc.setAttribute('aria-label', t('mtToc')); tap(tc, opts.onToc); }   // TOC toggle — sits in the ✕'s left slot; only when the host wants it (marktile passes onToc; tugtile's card modal doesn't)
    if (opts.onCancel) { const x = bar.createEl('button', { cls: 'tugtile-iconbtn tugtile-ed-x' }); setIcon(x.createSpan(), 'x'); x.setAttribute('aria-label', t('cancel')); tap(x, opts.onCancel); }   // ✕ — Lucide icon (matches the toolbar), span-nested for iPad; only when the host wants a cancel affordance (modal)
    const tools = bar.createDiv({ cls: 'tugtile-ed-tools' });
    if (opts.onSave) { const ok = bar.createEl('button', { cls: 'tugtile-iconbtn tugtile-ed-ok' }); setIcon(ok.createSpan(), 'check'); ok.setAttribute('aria-label', t('save')); tap(ok, opts.onSave); }   // ✓ — Lucide check; only for the modal (the file view autosaves)
    // Phone: split the toolbar — the top bar keeps the essentials (search/undo/redo, centered between ✕ ✓),
    // the format/insert tools drop to a second row below so the cramped phone bar isn't a long scroll.
    const twoRow = Platform.isPhone;
    // Phone: two rows. Top = the bar itself (✕ [undo·redo·headings·bold/italic/strike] ✓). Bottom = tools2
    // (search + lists/quote/code/link/date/time). The dedicated essentials bar is gone — everything moved up.
    const tools2 = twoRow ? contentEl.createDiv({ cls: 'tugtile-ed-tools2' }) : null;

    // Editor body: a single contenteditable surface. A <textarea> can only carry one uniform font, so it
    // can never size a heading line up. contenteditable can — each line keeps its literal markdown ('## ')
    // AND renders bigger (no Obsidian-style concealment). The visible text IS the editable text (one layer),
    // so the caret needs no overlay alignment. A scroll wrapper owns scrolling so touch-drag works unfocused.
    const scroll = contentEl.createDiv({ cls: 'tugtile-ed-scroll' });
    const ed = scroll.createDiv({ cls: 'tugtile-ed tugtile-ed-rich', attr: { contenteditable: 'true', spellcheck: 'false', autocapitalize: 'off' } });

    // --- Text <-> DOM model: each line is a top-level <div class="tg-line">; an empty line is <div><br></div>. ---
    const textOfLine = (d) => (d ? d.textContent : '');
    const getText = () => {
      const kids = ed.childNodes;
      let allDiv = kids.length > 0;
      for (const n of kids) { if (!(n.nodeType === 1 && n.tagName === 'DIV')) { allDiv = false; break; } }
      if (allDiv) return Array.from(kids).map((d) => d.textContent).join('\n');
      // Transient fallback (right after a native keystroke, before re-highlight normalizes the DOM back to clean line divs)
      let out = '';
      const walk = (n) => {
        if (n.nodeType === 3) { out += n.nodeValue; return; }
        if (n.tagName === 'BR') { out += '\n'; return; }
        if ((n.tagName === 'DIV' || n.tagName === 'P') && out && !out.endsWith('\n')) out += '\n';
        for (const ch of n.childNodes) walk(ch);
      };
      for (const n of kids) walk(n);
      return out.replace(/\u200b/g, '');
    };
    let lineCount = 0;
    const render = (text) => { ed.innerHTML = highlightMarkdown(text); lineCount = ed.children.length; };

    // --- Caret <-> character offset, so toolbar ops / find-replace / undo can address the document linearly ---
    const charsBeforeInLine = (lineEl, node, off) => {
      if (node === lineEl) { let c = 0; for (let i = 0; i < off; i++) c += (lineEl.childNodes[i].textContent || '').length; return c; }
      let count = 0, done = false;
      const walk = (n) => {
        if (done) return;
        if (n === node) { count += off; done = true; return; }
        if (n.nodeType === 3) { count += n.nodeValue.length; return; }
        for (const ch of n.childNodes) { walk(ch); if (done) return; }
      };
      walk(lineEl);
      return count;
    };
    const offsetAt = (node, off) => {
      const lines = Array.from(ed.children);
      if (node === ed) { let t = 0; for (let i = 0; i < off; i++) t += textOfLine(lines[i]).length + 1; return t; }
      let lineEl = node; while (lineEl && lineEl.parentNode !== ed) lineEl = lineEl.parentNode;
      const idx = lines.indexOf(lineEl); if (idx < 0) return 0;
      let t = 0; for (let i = 0; i < idx; i++) t += textOfLine(lines[i]).length + 1;
      return t + charsBeforeInLine(lineEl, node, off);
    };
    const locateInLine = (lineEl, within) => {
      let remaining = within, res = null;
      const walk = (n) => {
        if (res) return;
        if (n.nodeType === 3) { const L = n.nodeValue.length; if (remaining <= L) { res = { node: n, off: remaining }; return; } remaining -= L; return; }
        for (const ch of n.childNodes) { walk(ch); if (res) return; }
      };
      walk(lineEl);
      return res || { node: lineEl, off: 0 };
    };
    const locate = (target) => {
      const lines = Array.from(ed.children); let acc = 0;
      for (let i = 0; i < lines.length; i++) { const len = textOfLine(lines[i]).length; if (target <= acc + len) return locateInLine(lines[i], target - acc); acc += len + 1; }
      const last = lines[lines.length - 1];
      return last ? locateInLine(last, textOfLine(last).length) : { node: ed, off: 0 };
    };
    let lastSel = { start: 0, end: 0 };
    const readSel = () => {
      const s = window.getSelection();
      if (!s || s.rangeCount === 0) return null;
      const r = s.getRangeAt(0);
      if (!ed.contains(r.startContainer)) return null;
      return { start: offsetAt(r.startContainer, r.startOffset), end: offsetAt(r.endContainer, r.endOffset) };
    };
    const sel = () => readSel() || lastSel;
    const setSel = (s, e) => {
      const a = locate(s), b = locate(e === undefined ? s : e);
      const r = document.createRange(); r.setStart(a.node, a.off); r.setEnd(b.node, b.off);
      const ws = window.getSelection(); ws.removeAllRanges(); ws.addRange(r);
      lastSel = { start: s, end: (e === undefined ? s : e) };
    };
    ['keyup', 'mouseup', 'touchend'].forEach((ev) => ed.addEventListener(ev, () => { const r = readSel(); if (r) lastSel = r; }));

    // --- Undo / redo: our own snapshot stack (innerHTML rebuilds wipe the browser's native undo history) ---
    let hist = [], hi = -1;
    const pushHist = () => {
      const snap = { v: getText(), s: (readSel() || lastSel) };
      if (hi >= 0 && hist[hi].v === snap.v) { hist[hi].s = snap.s; return; }
      const seeded = hi >= 0;   // false only for the very first (seed) snapshot on mount
      hist = hist.slice(0, hi + 1); hist.push(snap); if (hist.length > 200) hist.shift(); hi = hist.length - 1;
      if (seeded && opts.onChange) opts.onChange();   // notify the host (marktile autosave) only for real edits, not the initial mount seed (B3)
    };
    const restore = (snap) => { render(snap.v); setSel(snap.s.start, snap.s.end); ed.focus(); };

    // --- Re-highlight, caret-preserving. Skipped while an IME is composing so CJK input is never interrupted. ---
    let composing = false, syncT = null;
    const rehighlight = () => { const r = readSel() || lastSel; render(getText()); setSel(r.start, r.end); };
    // Fast path: re-highlight ONLY the caret's line in place (no whole-document rebuild). Returns false —
    // forcing a full rehighlight — whenever the structure changed (line added/removed, content merged, or a
    // ranged selection), so the worst case is exactly the old behavior.
    const rehighlightLine = () => {
      const s = window.getSelection();
      if (!s || s.rangeCount === 0) return false;
      const r = s.getRangeAt(0);
      if (!r.collapsed || !ed.contains(r.startContainer)) return false;
      if (ed.children.length !== lineCount) return false;
      let lineEl = r.startContainer; while (lineEl && lineEl.parentNode !== ed) lineEl = lineEl.parentNode;
      if (!lineEl || lineEl.parentNode !== ed) return false;
      const text = lineEl.textContent;
      if (text.indexOf('\n') >= 0) return false;
      // Block state is a property of the whole document, and this path only has one line. The line
      // KNOWS what it was — the class the last full render gave it — which is enough to keep typing
      // inside a code block from being re-styled as markdown. But a line that becomes (or stops
      // being) a fence changes the meaning of every line after it, so that one hands back to the
      // full render rather than guessing.
      const was = lineEl.classList.contains('tg-cblock') ? 'cblock'
                : lineEl.classList.contains('tg-fm') ? 'fm'
                : lineEl.classList.contains('tg-cfence') ? 'cfence'
                : lineEl.classList.contains('tg-fmfence') ? 'fmfence' : null;
      const isFenceNow = FENCE.test(text) || /^(---|\.\.\.)[ \t]*$/.test(text);
      if (isFenceNow !== (was === 'cfence' || was === 'fmfence')) return false;
      const within = charsBeforeInLine(lineEl, r.startContainer, r.startOffset);
      const p = highlightLineParts(text, was);
      lineEl.className = p.cls; lineEl.innerHTML = p.inner;
      const loc = locateInLine(lineEl, within);
      const nr = document.createRange(); nr.setStart(loc.node, loc.off); nr.collapse(true);
      s.removeAllRanges(); s.addRange(nr);
      const off = offsetAt(loc.node, loc.off); lastSel = { start: off, end: off };
      return true;
    };
    const scheduleSync = () => { clearTimeout(syncT); syncT = setTimeout(() => { if (composing) return; const v = getText(), r = renumberLists(v); if (r !== v) { const c = readSel() || lastSel; render(r); setSel(c.start, c.end); pushHist(); return; } if (!rehighlightLine()) rehighlight(); pushHist(); }, 140); };   // on idle: if an ordered list fell out of sequence (item deleted/moved) renumber it once; else the normal light rehighlight
    ed.addEventListener('compositionstart', () => { composing = true; });
    ed.addEventListener('compositionend', () => { composing = false; scheduleSync(); });
    ed.addEventListener('input', () => { if (!composing) scheduleSync(); });

    // ── Links are doors, on ⌘-click ────────────────────────────────────────────────────────────
    // Until now every link in this editor was decoration: `[text](url)`, `<autolink>` and
    // `[[wikilink]]` were all styled and all inert, on every surface. A plain click still has to
    // place the caret — this is a source editor and the text under the pointer is text — so the
    // door is ⌘-click, the same gesture every Mac editor uses for exactly this.
    //
    // WHICH KIND OF LINK IT IS, IS WRITTEN IN THE MARKERS. All three render as `.tg-link` and the
    // temptation is to tell them apart with a data- attribute; but the opening marker already says
    // `[[` or `<` or `[`, it is right there in the DOM, and it round-trips because it is the text.
    // Reading it costs nothing and adds no second source of truth to keep in sync.
    const linkAt = (node) => {
      let el = node && node.nodeType === 3 ? node.parentElement : node;
      while (el && el !== ed && !(el.classList && /\btg-(link|img|ref)\b/.test(el.className))) el = el.parentElement;
      if (!el || el === ed) return null;
      const marks = Array.from(el.children).filter((c) => c.classList && c.classList.contains('tg-mk'));
      if (marks.length < 2) return null;
      const open = marks[0].textContent, close = marks[marks.length - 1].textContent;
      // The label is everything that is not a marker — for a wikilink that IS the target.
      const label = Array.from(el.childNodes)
        .filter((n) => !(n.nodeType === 1 && n.classList && n.classList.contains('tg-mk')))
        .map((n) => n.textContent).join('');
      if (open === '[[') return { kind: 'wiki', target: label.split('|')[0].split('#')[0].trim(), label: label };
      if (open === '<') return { kind: 'url', target: label.trim(), label: label };
      const md = /^\]\(([^)]*)\)$/.exec(close);
      if (md) return { kind: open === '![' ? 'image' : 'url', target: md[1].trim(), label: label };
      // A reference link or footnote — the label is styled but nothing here resolves what it points
      // at, which is a document-wide question this editor deliberately does not answer.
      return { kind: 'ref', target: label.trim(), label: label };
    };
    const openLinkAt = (node) => {
      const link = linkAt(node);
      if (!link || !link.target) return false;
      if (typeof host.openLink !== 'function') return false;   // a host that has no opener has no door
      host.openLink(link);
      return true;
    };
    // WHO OWNS THE PLAIN CLICK. The caret does — but only while the syntax is on screen. Two states
    // hand it over, and both for the same reason rather than as two special cases:
    //   • LOCKED — the editor refuses edits, so there is no caret competing for the click at all.
    //   • RENDERED — `.tg-mk` is hidden, which means the URL inside `](…)` is not on screen. Placing
    //     a caret inside a link you cannot see the address of buys nothing; and a document that has
    //     dropped its markers to look like a document should behave like one when you click a link.
    // In Seasoned and Plain the markers are visible, you are plainly in source, and ⌘ is the price.
    const readerMode = () => ed.getAttribute('contenteditable') === 'false' || !!ed.closest('.tugtile-preview');
    ed.addEventListener('click', (e) => {
      if (!(e.metaKey || e.ctrlKey) && !readerMode()) return;   // source + unlocked: caret wins
      if (openLinkAt(e.target)) { e.preventDefault(); e.stopPropagation(); }
    });
    // The pointer is the whole affordance. In reader mode it is always on, because there the link is
    // simply clickable; in source it appears only while ⌘ is held, since the gesture is otherwise
    // undiscoverable — there is no underline to hint at it the rest of the time.
    const armed = (e) => ed.classList.toggle('tugtile-ed-linkable', !!(e && (e.metaKey || e.ctrlKey)) || readerMode());
    ['keydown', 'keyup'].forEach((ev) => document.addEventListener(ev, armed));
    ed.addEventListener('mouseenter', armed);
    ed.addEventListener('mouseleave', () => ed.classList.toggle('tugtile-ed-linkable', readerMode()));

    render(orig); pushHist();
    const scrollCaretIntoView = () => { let el = locate(sel().start).node; if (el.nodeType === 3) el = el.parentElement; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); };
    // Programmatic edit (toolbar / find-replace): replace whole text, set caret, snapshot for undo
    const applyEdit = (newText, s, e) => { if (ed.getAttribute('contenteditable') === 'false') return; render(newText); setSel(s, (e === undefined ? s : e)); ed.focus(); pushHist(); };   // read-only guard: blocks toolbar + find/replace edits when the host locks the editor (B2)

    // Adapter exposing the slice of the <textarea> API the rest of the modal (and attachDatePicker) relies on
    const ta = {
      get value() { return getText(); },
      set value(v) { render(v); },
      get selectionStart() { return sel().start; },
      get selectionEnd() { return sel().end; },
      setSelectionRange(s, e) { setSel(s, e); },
      focus() { ed.focus(); },
      get scrollTop() { return scroll.scrollTop; }, set scrollTop(y) { scroll.scrollTop = y; },
      get clientHeight() { return scroll.clientHeight; },
      getBoundingClientRect() { return ed.getBoundingClientRect(); },
      addEventListener(...a) { ed.addEventListener(...a); },
      setAttribute() {},
    };

    // ---- Find / replace (toggled by the 🔍 toolbar button) ----
    const findbar = contentEl.createDiv({ cls: 'tugtile-ed-find' });
    contentEl.insertBefore(findbar, scroll);   // Between the toolbar and the editor body
    findbar.style.display = 'none';
    // Two groups, not one flat row. ▲▼ step through FIND matches, so they belong beside the find field;
    // flat, they landed on the far side of the replace box, with the whole replace field wedged between a
    // search term and the arrows that move through it. Grouping also gives the row somewhere sane to wrap.
    const findGrp = findbar.createSpan({ cls: 'tugtile-ed-find-grp' });
    const replGrp = findbar.createSpan({ cls: 'tugtile-ed-find-grp' });
    // A magnifier inside the pill, so the field says what it is without spending a placeholder on it.
    // It is also where the scope control will live — "search everything" is a property of THIS field,
    // not a separate button somewhere else on the bar.
    // The magnifier is the scope control when the host can widen the search — one click from "this
    // file" to "every document". It is a plain glyph otherwise, so a host without searchAll never
    // shows a door that leads nowhere. Deliberately NOT a double-click on the toolbar's 🔍: telling
    // one click from two means delaying the single-click response by the double-click interval,
    // which makes the ordinary case feel broken to buy the rare one.
    const findLead = findGrp.createSpan({ cls: 'tugtile-ed-find-lead' });
    setIcon(findLead, 'search');
    const findInp = findGrp.createEl('input', { cls: 'tugtile-ed-find-i', type: 'text', attr: { placeholder: t('findPlaceholder') } });
    const findN = findGrp.createSpan({ cls: 'tugtile-ed-find-n' });
    const replInp = replGrp.createEl('input', { cls: 'tugtile-ed-find-i', type: 'text', attr: { placeholder: t('replacePlaceholder') } });
    const lc = (s) => (s || '').toLowerCase();
    const updateN = () => { const term = findInp.value; findN.textContent = term ? String(lc(ta.value).split(lc(term)).length - 1) : ''; };
    const findNext = (back) => {
      const term = findInp.value; if (!term) return;
      const hay = lc(ta.value), needle = lc(term);
      let idx;
      if (back) { idx = hay.lastIndexOf(needle, Math.max(0, ta.selectionStart - 1)); if (idx < 0) idx = hay.lastIndexOf(needle); }
      else { idx = hay.indexOf(needle, ta.selectionEnd); if (idx < 0) idx = hay.indexOf(needle); }   // wrap around
      if (idx < 0) return;
      ed.focus(); setSel(idx, idx + term.length); scrollCaretIntoView();
    };
    const doReplace = () => {
      const term = findInp.value; if (!term) return;
      const v = getText(), s = sel().start, e = sel().end;
      if (lc(v.slice(s, e)) === lc(term)) applyEdit(v.slice(0, s) + replInp.value + v.slice(e), s + replInp.value.length);
      findNext(false); updateN();
    };
    const doReplaceAll = () => {
      const term = findInp.value; if (!term) return;
      const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      applyEdit(getText().replace(re, replInp.value), sel().start); updateN();
    };
    const toggleFind = (show) => {
      const on = (show === undefined) ? (findbar.style.display === 'none') : show;
      findbar.style.display = on ? '' : 'none';
      if (on) { updateN(); setTimeout(() => findInp.focus(), 0); } else { ta.focus(); }
    };

    // ── Search every document ──────────────────────────────────────────────────────────────────
    // A CENTRED OVERLAY, not a side panel, and the reason is what happens when you pick a result:
    // the table of contents is about THIS document and stays with you, while this is about other
    // documents and choosing one ends the panel's job. That is the shape of Spotlight, of Open
    // Quickly, of ⌘P — and of Obsidian's own quick switcher, which is a modal even though its
    // sidebar search is not. Results also need the width: the context line is what tells you it is
    // the right file, and a 240px rail truncates exactly that.
    //
    // The engine owns none of the searching. `host.searchAll(query)` returns
    // { hits:[{path,name,line,text,before,after,age}], offline:[path], files, skipped } — the shape
    // ffcore.passages already produces — and a host that does not provide it gets no scope control
    // at all, so nothing here can advertise a capability that is not there.
    const canSearchAll = typeof host.searchAll === 'function';
    let panel = null, panelState = { q: '', res: null, sel: 0 };

    const openResult = (hit) => {
      if (typeof host.openLink === 'function') host.openLink({ kind: 'file', target: hit.path, line: hit.line, label: hit.name });
      toggleSearchAll(false);
    };

    const drawResults = () => {
      const list = panel.querySelector('.tugtile-sa-list');
      const stat = panel.querySelector('.tugtile-sa-stat');
      list.empty(); stat.textContent = '';
      const r = panelState.res;
      if (!r) { list.createDiv({ cls: 'tugtile-sa-hint', text: t('searchAllHint') }); return; }
      const bits = [t('searchAllStat', r.files, r.hits.length)];
      if (r.skipped) bits.push(t('searchAllCapped', r.files - r.skipped, r.files));
      if (r.offline && r.offline.length) bits.push(t('searchAllOffline', r.offline.length));
      stat.textContent = bits.join(' · ');
      if (!r.hits.length) { list.createDiv({ cls: 'tugtile-sa-hint', text: t('searchAllNone') }); return; }
      r.hits.forEach((h, i) => {
        const row = list.createDiv({ cls: 'tugtile-sa-row' + (i === panelState.sel ? ' is-sel' : '') });
        const head = row.createDiv({ cls: 'tugtile-sa-head' });
        head.createSpan({ cls: 'tugtile-sa-name', text: h.name + ':' + h.line });
        if (h.age != null) head.createSpan({ cls: 'tugtile-sa-age', text: Math.round(h.age) + 'd' });
        if (h.before) row.createDiv({ cls: 'tugtile-sa-ctx', text: h.before });
        row.createDiv({ cls: 'tugtile-sa-hit', text: h.text });
        if (h.after) row.createDiv({ cls: 'tugtile-sa-ctx', text: h.after });
        row.addEventListener('mousedown', (e) => { e.preventDefault(); openResult(h); });
      });
      const sel = list.querySelector('.is-sel');
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
    };

    let searchSeq = 0;
    // 🔴 THE ANSWER ARRIVES IN MORE THAN ONE PIECE, and the reason is a real measurement rather than
    // a taste for streaming. Covering what the index refuses to look at means READING those files —
    // about 11,500 of them, ~0.6s to walk and ~1.3s to read. That is a fair price on a command line
    // and a bad one under a panel that searches while you type: every keystroke would buy a
    // multi-second stare at nothing.
    //
    // So `host.searchAll(query, onPartial)` may call `onPartial` as many times as it likes before
    // resolving. The indexed half lands almost immediately and is shown; the unindexed half is
    // merged in when it arrives. What this preserves is the property the whole blind-spot fix was
    // for — "nothing found" here means nothing exists, not "nothing was looked at" — while refusing
    // to charge the reader for it up front. A host that ignores onPartial and resolves once still
    // works exactly as before.
    const applyResult = (res, seq, done) => {
      if (seq !== searchSeq) return;      // a slower earlier query must never overwrite a newer answer
      if (done) panel.classList.remove('is-busy');
      const next = res && res.hits ? res : { hits: [], offline: [], files: 0, skipped: 0 };
      // The SELECTION is kept across a merge, by identity rather than by index: a result arriving
      // late must never move what the arrow keys are pointing at, or a list that grows under you
      // steals the Enter you were about to press.
      const chosen = panelState.res && panelState.res.hits[panelState.sel];
      panelState.res = next;
      const at = chosen ? next.hits.findIndex((h) => h.path === chosen.path && h.line === chosen.line) : -1;
      panelState.sel = at >= 0 ? at : 0;
      drawResults();
    };

    const runSearch = (q) => {
      panelState.q = q;
      if (!q.trim()) { panelState.res = null; panelState.sel = 0; drawResults(); return; }
      const mine = ++searchSeq;
      panel.classList.add('is-busy');
      Promise.resolve(host.searchAll(q, (partial) => applyResult(partial, mine, false)))
        .then((res) => applyResult(res, mine, true))
        .catch(() => applyResult(null, mine, true));
    };

    const buildPanel = () => {
      const wrap = contentEl.createDiv({ cls: 'tugtile-sa' });
      wrap.createDiv({ cls: 'tugtile-sa-scrim' }).addEventListener('mousedown', () => toggleSearchAll(false));
      const box = wrap.createDiv({ cls: 'tugtile-sa-box' });
      const top = box.createDiv({ cls: 'tugtile-sa-top' });
      setIcon(top.createSpan({ cls: 'tugtile-ed-find-lead' }), 'search');
      const inp = top.createEl('input', { cls: 'tugtile-sa-i', type: 'text', attr: { placeholder: t('searchAllPlaceholder') } });
      top.createSpan({ cls: 'tugtile-sa-stat' });
      box.createDiv({ cls: 'tugtile-sa-list' });
      let debounce;
      inp.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => runSearch(inp.value), 220); });
      inp.addEventListener('keydown', (e) => {
        const hits = (panelState.res && panelState.res.hits) || [];
        if (e.key === 'Escape') { e.preventDefault(); toggleSearchAll(false); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); panelState.sel = Math.min(panelState.sel + 1, hits.length - 1); drawResults(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); panelState.sel = Math.max(panelState.sel - 1, 0); drawResults(); }
        else if (e.key === 'Enter') { e.preventDefault(); clearTimeout(debounce); if (hits[panelState.sel]) openResult(hits[panelState.sel]); else runSearch(inp.value); }
      });
      return wrap;
    };

    // Reopening restores the last query AND its results, the way Spotlight does. That is what makes
    // "read three of these in turn" work without keeping a panel on screen — the state persists, the
    // pixels do not. The find bar already behaves this way; this follows its sibling rather than
    // inventing a second convention.
    const toggleSearchAll = (show) => {
      if (!canSearchAll) return false;
      if (!panel) panel = buildPanel();
      const on = (show === undefined) ? !panel.classList.contains('is-open') : show;
      panel.classList.toggle('is-open', on);
      if (on) {
        const inp = panel.querySelector('.tugtile-sa-i');
        inp.value = panelState.q;
        drawResults();
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
      } else { ed.focus(); }
      return true;
    };
    const mkFb = (icon, aria, fn, target) => { const b = (target || findbar).createEl('button', { cls: 'tugtile-iconbtn tugtile-ed-find-b' }); setIcon(b.createSpan(), icon); b.setAttribute('aria-label', aria); b.addEventListener('mousedown', (e) => e.preventDefault()); b.addEventListener('click', fn); b.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false }); };
    mkFb('chevron-up', t('findPrev'), () => findNext(true), findGrp);
    mkFb('chevron-down', t('findNext'), () => findNext(false), findGrp);
    mkFb('replace', t('replaceOne'), doReplace, replGrp);
    mkFb('replace-all', t('replaceAll'), doReplaceAll, replGrp);
    mkFb('x', t('cancel'), () => toggleFind(false));   // stays a direct child — CSS pushes it to the far edge
    findInp.addEventListener('input', updateN);
    findInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findNext(!!e.shiftKey); } else if (e.key === 'Escape') { e.preventDefault(); toggleFind(false); } });
    if (canSearchAll) {
      findLead.classList.add('is-scope');
      findLead.setAttribute('role', 'button');
      findLead.setAttribute('tabindex', '0');
      findLead.setAttribute('aria-label', t('searchAll'));   // the tooltip mirror picks this up too
      // The query you already typed travels with you — escalating is widening the SAME search, not
      // starting a new one, and retyping it would be the tool forgetting what you just said.
      const widen = () => { panelState.q = findInp.value || panelState.q; toggleFind(false); toggleSearchAll(true); if (panelState.q) runSearch(panelState.q); };
      findLead.addEventListener('mousedown', (e) => { e.preventDefault(); widen(); });
      findLead.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); widen(); } });
      // ⌘F⌘F. The second press lands while the find field has focus, so "press it again" is the
      // whole gesture — no new shortcut to learn, and it reads as widening rather than as a
      // different feature.
      findInp.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); widen(); }
      });
    }

    // Editor shortcuts: edit the text model directly, then applyEdit re-highlights + snapshots undo; mousedown preventDefault retains the caret
    const wrap = (pre, post) => { const v = getText(), s = sel().start, e = sel().end; applyEdit(v.slice(0, s) + pre + v.slice(s, e) + post + v.slice(e), s + pre.length, e + pre.length); };
    const lineStartOf = (v, pos) => v.lastIndexOf('\n', pos - 1) + 1;
    // The list tools (bullet / number / check) go through setListKind, which treats the three as ONE family:
    // pressing 編號 on a bullet line REPLACES the marker instead of prepending to it. See setListKind above.
    const setList = (kind) => { const r = setListKind(getText(), sel().start, sel().end, kind); applyEdit(r.text, r.start, r.end); };
    // Line-prefix tool — now only quote, which is a separate axis (it nests with lists: "> - item" is valid).
    // With a SELECTION it applies to EVERY line the selection touches; with just a caret it toggles that one
    // line (caret kept). Blank lines are left alone. Toggles OFF only when every non-blank line already has it.
    const togglePre = (pre) => {
      const v = getText(), s = sel().start, e = sel().end;
      const has = (ln) => ln.startsWith(pre);
      const strip = (ln) => ln.slice(pre.length);
      if (s === e) {   // no selection → just the caret's line, caret preserved
        const ls = lineStartOf(v, s), ln = v.slice(ls), h = has(ln);
        const nv = h ? v.slice(0, ls) + strip(ln) : v.slice(0, ls) + pre + v.slice(ls);
        applyEdit(nv, Math.max(ls, s + (h ? -pre.length : pre.length)));
        return;
      }
      const firstLs = lineStartOf(v, s), lastLs = lineStartOf(v, e - 1);
      const nlAfter = v.indexOf('\n', lastLs), blockEnd = nlAfter === -1 ? v.length : nlAfter;
      const lines = v.slice(firstLs, blockEnd).split('\n');
      const nonBlank = lines.filter((ln) => ln.trim() !== '');
      const allHave = nonBlank.length > 0 && nonBlank.every(has);
      const out = lines.map((ln) => {
        if (ln.trim() === '') return ln;                                   // leave blank lines alone
        if (allHave) return strip(ln);                                     // every non-blank has it → remove
        return has(ln) ? ln : pre + ln;                                    // add where missing
      }).join('\n');
      applyEdit(v.slice(0, firstLs) + out + v.slice(blockEnd), firstLs, firstLs + out.length);   // keep the block selected
    };
    const setHeading = (hashes) => { const v = getText(), s = sel().start, ls = lineStartOf(v, s); const rest = v.slice(ls); const m = /^#{1,6}[ \t]/.exec(rest); const cur = m ? m[0].length : 0; const repl = (m && m[0] === hashes) ? '' : hashes; const nv = v.slice(0, ls) + repl + rest.slice(cur); const np = Math.max(ls, s + (repl.length - cur)); applyEdit(nv, np); };
    // Bind a toolbar button so a TAP fires the action (keeping editor focus) but a SWIPE scrolls the row instead.
    // The old approach fired on touchstart+preventDefault, which was hair-trigger and blocked horizontal scrolling.
    const bindTap = (b, run) => {
      let tx = 0, ty = 0, moved = false;
      b.addEventListener('mousedown', (e) => e.preventDefault());   // Mouse: prevents focus loss in the editor
      b.addEventListener('click', run);                             // Mouse click path (suppressed on touch by the touchend below)
      b.addEventListener('touchstart', (e) => { const t = e.touches[0]; tx = t.clientX; ty = t.clientY; moved = false; }, { passive: true });
      b.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (Math.abs(t.clientX - tx) > 10 || Math.abs(t.clientY - ty) > 10) moved = true; }, { passive: true });
      b.addEventListener('touchend', (e) => { if (!moved) { e.preventDefault(); run(); } }, { passive: false });   // Fire only on a tap, not a scroll; preventDefault retains focus + blocks the synthetic click
    };
    const tbtn = (label, fn, icon, target, tip) => {
      const b = (target || tools).createEl('button', { cls: 'tugtile-iconbtn tugtile-ed-tool' });
      if (tip) b.setAttribute('aria-label', t(tip));   // hover tooltip + accessible name (every tool button — was missing)
      // setIcon into a child <span>, NOT the <button> directly — iPad WebKit won't render an inline svg that's
      // a direct button child. setIcon is SILENT on an unknown name (the shim's ICONS lookup, and Obsidian's own
      // Lucide subset, which does not ship every Lucide icon) — it just leaves the span empty, and an empty span
      // in a sized button is the blank-button bug that shim-icons.test.cjs exists for. That test can only police
      // OUR shim; nothing here can police Obsidian's set. So: if nothing got drawn, fall back to the text glyph.
      // A button that reads 'Tx' is worse-looking than an icon and infinitely better than one that reads nothing.
      if (icon) { const sp = b.createSpan(); setIcon(sp, icon); if (!sp.firstChild) { sp.remove(); b.textContent = label; } }
      else b.textContent = label;
      bindTap(b, () => { fn(); ed.focus(); });   // fn (applyEdit / undo / redo) already re-renders and refocuses
    };
    const insertTok = (tok) => { const v = getText(), s = sel().start; applyEdit(v.slice(0, s) + tok + v.slice(s), s + tok.length); };
    // image/video toolbar buttons: the host's pick hook (opts.pickImage/pickVideo) returns a markdown token (the
    // markup is uniform across surfaces; only WHERE the bytes live differs per platform). The picker is async and
    // blurs the editor (file dialog / prompt) → capture the caret BEFORE, re-insert at that offset when it resolves.
    const insertViaPick = (pick) => {
      if (typeof pick !== 'function' || ed.getAttribute('contenteditable') === 'false') return;
      const at = sel().start;
      Promise.resolve(pick()).then((tok) => {
        if (!tok || ed.getAttribute('contenteditable') === 'false') return;
        const v = getText(); applyEdit(v.slice(0, at) + tok + v.slice(at), at + tok.length);
      }).catch(() => {});
    };
    const runs = {
      undo: () => { if (hi > 0) { hi--; restore(hist[hi]); } }, redo: () => { if (hi < hist.length - 1) { hi++; restore(hist[hi]); } },
      h1: () => setHeading('# '), h2: () => setHeading('## '), h3: () => setHeading('### '),
      bold: () => wrap('**', '**'), italic: () => wrap('*', '*'), strike: () => wrap('~~', '~~'),
      // Clear formatting works on whole LINES, because half of what it removes (heading, quote, list marker) is a
      // property of a line, not of a span. With no selection that means the caret's line — the same scope Word
      // and Pages use when you clear formatting without selecting anything.
      clear: () => {
        const v = getText(), s = sel().start, e = sel().end;
        const firstLs = lineStartOf(v, s), lastLs = lineStartOf(v, e > s ? e - 1 : s);
        const nlAfter = v.indexOf('\n', lastLs), blockEnd = nlAfter === -1 ? v.length : nlAfter;
        const out = stripFormatting(v.slice(firstLs, blockEnd));
        applyEdit(v.slice(0, firstLs) + out + v.slice(blockEnd), firstLs, firstLs + out.length);
      },
      bullet: () => setList('bullet'), number: () => setList('number'), check: () => setList('check'), quote: () => togglePre('> '),
      table: () => { const v = getText(), s = sel().start, ls = lineStartOf(v, s); const pre = (ls > 0 && v[ls - 1] !== '\n') ? '\n' : ''; const tbl = pre + '|  |  |\n| --- | --- |\n|  |  |\n'; applyEdit(v.slice(0, ls) + tbl + v.slice(ls), ls + pre.length + 2); },   // insert a starter 2×2 table; decorateTables grids it for in-place editing
      code: () => wrap('`', '`'), link: () => wrap('[[', ']]'),
      image: () => insertViaPick(opts.pickImage), video: () => insertViaPick(opts.pickVideo),
      date: () => insertTok(host.dateTrigger || '@'), time: () => insertTok(host.timeTrigger || '@@'),
    };
    // Build the toolbar from EDITOR_TOOLS, honoring the per-button on/off settings; separators only appear between non-empty groups
    const en = host.plugin.settings.editorTools || {};
    // Phone rows: TOP = the bar's `tools` (search·undo·redo, the essentials); BOTTOM = tools2 (ALL format/insert
    // tools in one horizontally-scrollable row). 'rowbreak' is now a plain separator (phone seps are hidden anyway).
    let pendingSep = false;
    EDITOR_TOOLS.forEach((tk) => {
      if (tk === 'sep' || tk === 'rowbreak') { pendingSep = true; return; }
      if (en[tk.key] === false) return;   // honor per-button settings for ALL tools incl. search/undo/redo (so marktile can disable them); tugtile never sets these false → they stay on
      if (tk.needs && typeof opts[tk.needs] !== 'function') return;   // capability-gated tool (image/video): hide the button when the host didn't wire its hook → button exists IFF it works (no phantom)
      const target = tk.fixed ? tools : (twoRow ? tools2 : tools);   // fixed → bar; others → the second row on phone (the bar on desktop)
      if (pendingSep && target.childElementCount > 0) target.createDiv({ cls: 'tugtile-ed-sep' });   // separators (hidden in the compact phone rows) only between non-empty groups
      pendingSep = false;
      if (tk.key === 'search') {   // Special: toggles the find/replace bar (don't focus back to the textarea)
        const b = target.createEl('button', { cls: 'tugtile-iconbtn tugtile-ed-tool' });
        b.setAttribute('aria-label', t(tk.tip));   // "Find / replace"
        setIcon(b.createSpan(), 'search');   // span child, not the button (iPad svg-in-button fix)
        bindTap(b, () => toggleFind());
      } else {
        tbtn(tk.g, runs[tk.key], tk.icon, target, tk.tip);
      }
    });
    // A wrapped toolbar puts its dividers wherever the text would break: a `|` can end up first on a row,
    // separating the edge of the row from nothing, which is the small ugliness that makes a wrapped bar read
    // as debris rather than as a toolbar. CSS has no way to ask "is this element first on its line", so it is
    // measured. Rows are found by vertical CENTRE, not offsetTop — a 20px divider and a 40px button on the
    // same row have different tops by design. Hidden with `visibility`, never `display`, so the element keeps
    // its width and the fix cannot change the layout it just measured (and oscillate).
    const seps = () => [...(tools ? tools.children : [])].filter((e) => e.classList.contains('tugtile-ed-sep'));
    const tidySeps = () => {
      const kids = [...(tools ? tools.children : [])];
      const mid = (e) => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); };
      kids.forEach((el, i) => {
        if (!el.classList.contains('tugtile-ed-sep')) return;
        const prev = kids[i - 1], next = kids[i + 1];
        const alone = !prev || !next || mid(el) !== mid(prev) || mid(el) !== mid(next);
        el.style.visibility = alone ? 'hidden' : '';
      });
    };
    let sepRO = null;
    if (tools && seps().length && typeof ResizeObserver === 'function') {
      sepRO = new ResizeObserver(() => tidySeps());
      sepRO.observe(tools);
      tidySeps();
    }

    // Pure-source mode: if every tool is disabled and there's no ✕/✓ (marktile), drop the whole toolbar.
    if (!opts.onCancel && !opts.onSave && !tools.childElementCount && (!tools2 || !tools2.childElementCount)) { bar.remove(); if (tools2) tools2.remove(); }

    // Smart Enter: continue a list on newline (- / * / 1. / - [ ]); a second Enter on an empty item exits the
    // list. Runs through the proven applyEdit text-model (never touches the native Enter path), and only when
    // the caret line is actually a list item — otherwise it returns false and the native newline happens.
    const tryListContinue = () => {
      const r = readSel(); if (!r || r.start !== r.end) return false;   // collapsed caret only
      const res = listContinuation(getText(), r.start);
      if (!res) return false;
      applyEdit(res.text, res.caret);
      return true;
    };

    host.attachDatePicker(ta);
    ta.addEventListener('keydown', (e) => {
      if (host.isSubmitKey(e)) { e.preventDefault(); if (opts.onSubmit) opts.onSubmit(); return; }
      // Undo/redo via OUR snapshot stack (same as the toolbar buttons). The editor rebuilds innerHTML on every
      // re-highlight, which wipes the contenteditable's native undo — so Cmd+Z must NOT rely on the browser's
      // native undo (that's why it silently stopped working). preventDefault blocks native; stopPropagation keeps
      // the board's document-level ⌘Z handler out; the read-only guard mirrors the toolbar (locked = no edits).
      if ((e.metaKey || e.ctrlKey) && (e.key || '').toLowerCase() === 'z') {
        e.preventDefault(); e.stopPropagation();
        if (ed.getAttribute('contenteditable') !== 'false') { if (e.shiftKey) runs.redo(); else runs.undo(); }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key || '').toLowerCase() === 'y') {   // ⌘/Ctrl+Y = redo (Windows convention)
        e.preventDefault(); e.stopPropagation();
        if (ed.getAttribute('contenteditable') !== 'false') runs.redo();
        return;
      }
      if (e.key === 'Escape' && opts.onEscape) { e.preventDefault(); opts.onEscape(); return; }   // hosts without a cancel action (marktile) let Escape fall through naturally
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && tryListContinue()) e.preventDefault();   // newline-producing Enter (submit already handled above) → continue the list if on one
      if (e.key === 'Tab' && !e.isComposing) {   // insert/remove a literal tab (contenteditable's default Tab just moves focus)
        e.preventDefault();
        const r = readSel(); if (!r) return;
        const res = tabEdit(getText(), r.start, r.end, e.shiftKey);
        if (res) applyEdit(res.text, res.caret);
      }
    });
    // Only auto-focus a fresh (empty) card — then the keyboard is ready to type. For existing content, DON'T focus: leave it to the user's tap, so the caret lands where they tap instead of jumping to the end.
    if (!orig) setTimeout(() => ta.focus(), 0);

    // iOS virtual keyboard handling. Two defenses, because visualViewport doesn't reliably shrink in Obsidian's
    // webview: (1) if it DOES, cap the sizing container to the visible height so the scroll region ends above the
    // keyboard; (2) regardless, keep the caret line within the top ~45% of the scroll viewport — which is above
    // where the keyboard sits even when the scroll area itself extends under it. The editor content carries a
    // tall bottom padding (CSS) so there's always room to scroll the last real line up.
    const vv = window.visualViewport;
    const sizer = contentEl.closest('.tugtile-edit-modal-full');   // ONLY the full-screen card modal; null in marktile's pane (don't clamp a leaf to vv.height — that mis-sizes desktop split panes) (L4)
    const keepCaretVisible = () => {
      const n = locate(sel().start).node;
      const lineEl = (n && n.nodeType === 3) ? n.parentElement : n;
      if (!lineEl || !lineEl.getBoundingClientRect) return;
      const lr = lineEl.getBoundingClientRect(), sr = scroll.getBoundingClientRect();
      const upper = sr.top + sr.height * 0.45;
      if (lr.bottom > upper) scroll.scrollTop += (lr.bottom - upper);
    };
    const applyVV = () => { if (vv && sizer) { sizer.style.height = vv.height + 'px'; sizer.style.maxHeight = vv.height + 'px'; } setTimeout(keepCaretVisible, 0); };
    if (vv) { vv.addEventListener('resize', applyVV); vv.addEventListener('scroll', applyVV); applyVV(); }
    ed.addEventListener('input', () => setTimeout(keepCaretVisible, 0));   // keep the caret above the keyboard as you type

  return {
    getValue: () => getText().replace(/\s+$/, ''),
    rawValue: () => getText(),
    setText: (text) => { if (ed.getAttribute('contenteditable') === 'false') return; render(text); pushHist(); },   // programmatic whole-document replace (TOC drag-reorder); pushHist → undoable + fires onChange (autosave). read-only guard like applyEdit.
    isDirty: () => getText().replace(/\s+$/, '') !== orig.replace(/\s+$/, ''),
    insertText: (text) => insertTok(text),   // insert at the caret (used by image paste/drop); applyEdit's read-only guard applies
    // Every toolbar button, by key, for hosts that have a SECOND door to the same capability — a macOS menu
    // bar and its ⌘-equivalents. It is deliberately the same `runs` map the buttons are bound to: a menu that
    // reimplemented "bold" would be a second definition of what bold means, and the two would drift on the
    // first change. Returns false for an unknown key so a host can't silently ship a dead menu item.
    runTool: (key) => { const fn = runs[key]; if (!fn) return false; fn(); ed.focus(); return true; },
    toggleFind: (show) => toggleFind(show),   // ⌘F — the same bar the magnifier opens
    // ⌘F⌘F from the host's menu. Returns false when the host provides no searchAll, so the caller
    // can decline to offer the menu item rather than shipping one that does nothing.
    toggleSearchAll: (show) => toggleSearchAll(show),
    canSearchAll: () => canSearchAll,
    focus: () => ta.focus(),
    destroy: () => { clearTimeout(syncT); if (sepRO) { sepRO.disconnect(); sepRO = null; } if (vv) { vv.removeEventListener('resize', applyVV); vv.removeEventListener('scroll', applyVV); } if (sizer) { sizer.style.height = ''; sizer.style.maxHeight = ''; } },
  };
}

// Full-screen, keyboard-safe source editor. Callback-driven (opts.text / opts.onSave / opts.onDiscard) so board cards, table rows, and the whole markdown file all reuse it.
// Host interface the editor needs from whatever embeds it — the board view, or a minimal marktile file host.
// This is the seam that lets the SAME editor open a kanban card OR a standalone .md file. A host duck-types
// this surface (BoardView already does; a marktile host no-ops the board-only parts):
//   _editModalOpen (writable flag), freezeBoard(), unfreezeBoard(), closePopup(), consumePendingReload(),
//   attachDatePicker(taAdapter), isSubmitKey(e)->bool, dateTrigger, timeTrigger, plugin.settings.editorTools
class TileEditModal extends Modal {
  constructor(app, view, opts) { super(app); this.view = view; this.host = (opts && opts.host) || view; this._opts = opts || {}; }
  onOpen() {
    this.host._editModalOpen = true;
    this.host.freezeBoard();
    this.modalEl.addClass('tugtile-edit-modal-full');
    // Tag the modal CONTAINER so the backdrop/alignment rules can target it directly instead of via
    // .modal-container:has(.tugtile-edit-modal-full) — same timing as the modalEl class above, but no :has()
    // selector invalidation. Guarded: the web host's shim Modal may not expose containerEl.
    if (this.containerEl) this.containerEl.addClass('tugtile-edit-host');
    // Obsidian vault hooks (source path = the board file): image save/resolution. Computed up here so mountEditor's
    // toolbar image/video buttons and equipEditor's paste handler share the same seam.
    const app = this.app, srcPath = (this.view && this.view.file) ? this.view.file.path : '';
    this._ctrl = mountEditor(this.contentEl, {
      text: this._opts.text || '',
      onSubmit: () => this._doClose('save'), onEscape: () => this._requestClose(),   // keyboard: Enter saves, Escape cancels (the ✕/✓ buttons live in the control strip below)
      onToc: () => { if (this._rig && this._rig.toc) this._rig.toc.toggle(); },
      pickImage: () => pickVaultImage(app, srcPath), pickVideo: () => promptVideoEmbed(),   // toolbar 🖼/🎞 → vault save / URL embed
    }, this.host);
    // Equip the same rig marktile uses → tugtile's big editor is literally marktile + the ✕/✓ buttons. Host hooks:
    // Obsidian vault image resolution (source path = the board file) and the TOC's Sortable + mobile/anchor tuning.
    this._rig = equipEditor({
      mount: this.contentEl, ctrl: this._ctrl,
      enabledModes: (this.host.plugin && this.host.plugin.settings && this.host.plugin.settings.modes) || {},
      seasonedColor: !!(this.host.plugin && this.host.plugin.settings && this.host.plugin.settings.seasonedColor),
      saveImage: (blob) => saveVaultImage(app, srcPath, blob),   // paste/drop an image → vault attachment + ![[…]]
      resolveSrc: (raw) => {
        raw = String(raw).split('|')[0].trim();
        if (/^(https?:|data:|app:)/i.test(raw)) return raw;
        if (!/\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i.test(raw.split('#')[0])) return null;
        try { const f = app.metadataCache.getFirstLinkpathDest(raw, srcPath); return f ? app.vault.getResourcePath(f) : null; } catch (e) { return null; }
      },
      toc: {
        Sortable: (typeof Sortable !== 'undefined' ? Sortable : (typeof window !== 'undefined' ? window.Sortable : null)),
        labels: { title: t('mtToc'), empty: t('mtTocEmpty') },
        onReorder: () => {}, anchorScroll: '.tugtile-ed-scroll',
        sortableOptions: { delay: 180, delayOnTouchOnly: true, touchStartThreshold: 8, forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4, dragClass: 'marktile-toc-item--drag' },
      },
    });
    // Control strip in marktile's exact markup, prepended above the toolbar: [✕] · viewcycle · lock · [✓]. So the
    // big editor reads as marktile + the modal's cancel/save. (marktile builds the same-looking strip in its header.)
    const strip = createDiv({ cls: 'tugtile__ctlbar' });
    this._ctl = buildEditorCtl(strip, {
      cycleMode: () => { if (this._rig) this._rig.cycleMode(); },
      currentMode: () => (this._rig ? this._rig.currentMode() : EDITOR_MODES[0]),
      toggleLock: () => this._toggleLock(),
      isLocked: () => !!this._locked,
      brand: t('mtBrand'), brandLocked: t('mtBrandLocked'),
      modeLabel: t('mtModeToggle'), lockLabel: t('mtLockToggle'),
      onCancel: () => this._requestClose(), cancelLabel: t('cancel'),
      onSave: () => this._doClose('save'), saveLabel: t('save'),
    });
    this.contentEl.prepend(strip);
  }
  _toggleLock() { this._locked = !this._locked; this._applyLock(); }
  _applyLock() { const ed = this.contentEl.querySelector('.tugtile-ed-rich'); if (ed) ed.setAttribute('contenteditable', String(!this._locked)); this.contentEl.toggleClass('tugtile--locked', !!this._locked); }
  _dirty() { return !!this._ctrl && this._ctrl.isDirty(); }
  close() {
    if (this._forceClose) { this._animateClose(); return; }
    // Implicit closing (backdrop click or iOS virtual keyboard collapse) → ignored to prevent accidental close or save. Dismissed only via Save/Cancel/Escape.
  }
  _requestClose() {   // Explicit cancel (Cancel button or Escape key)
    if (!this._dirty()) { this._doClose('discard'); return; }
    if (typeof window.confirm === 'function') { if (window.confirm(t('discardConfirm'))) this._doClose('discard'); /* otherwise do nothing */ }
    else this._doClose('save');   // Mobile devices without confirm dialog → save changes to prevent data loss
  }
  _animateClose() {
    if (this._closing) { return; } this._closing = true;
    // Reverse exit animation: appends class to trigger pop-out animation, then closes. Saving has already finished in _doClose → _save; the animation is purely visual and does not delay saving.
    this.modalEl.addClass('tugtile-ed-closing');
    setTimeout(() => super.close(), 300);   // Align with pop-out animation duration (0.32s)
  }
  _doClose(mode) {
    this._forceClose = true;
    if (mode === 'save') this._save();
    else if (this._opts.onDiscard) this._opts.onDiscard();   // e.g. board discards a newly inserted empty card
    this.close();
  }
  onClose() {
    if (this._rig) { this._rig.destroy(); this._rig = null; }
    if (this._ctrl) this._ctrl.destroy();
    this.host._editModalOpen = false;
    this.host.unfreezeBoard();
    this.host.closePopup();
    this.contentEl.empty();
    this.host.consumePendingReload();   // Process external modifications deferred during modal editing
  }
  _save() {
    if (this._done) return; this._done = true;
    const v = this._ctrl ? this._ctrl.getValue() : '';
    if (this._opts.onSave) this._opts.onSave(v);
  }
}


// ───────────────────────────────────────────────────────────────────────────
// TABLE GRID (the "locked markers" in-grid markdown-table editor). Single source
// for tugtile/marktile (inlined) AND the web host (tile-core emit). decorateTables(root,
// ctrl, gateClass) restyles contiguous |table| line-divs into an aligned grid and
// makes them editable in place; gateClass selects the host's "grid on" class —
// both marktile and the web host use 'marktile-grid' (set in Seasoned + Rendered, dropped
// in Plain). The .tugtile-preview overlay then hides the pipes in Rendered, in CSS
// only. (gateClass defaults to 'tugtile-preview' for older callers.) textContent stays
// byte-identical → round-trip exact, no other core change.
// ───────────────────────────────────────────────────────────────────────────

// table-align — cheap markdown-table prettifier: pad cells with spaces so the pipes line up in a monospace
// editor. Stays single-layer (output is still valid markdown, edits in place, round-trips) — no CSS table, no
// widget. The one catch is CJK: 中文/日文/全形 are DOUBLE-width, so we measure DISPLAY width (east-asian-width),
// NOT code-point length, or the pipes drift. Pure string → runs in node + browser. See [[web-known-pitfalls]].

// East Asian Width: 2 for wide/fullwidth code points, else 1. Practical subset for zh/ja (not the full UAX#11
// table, but covers CJK ideographs, kana, hangul, and fullwidth forms/punctuation — what real content uses).
const WIDE = [
  [0x1100, 0x115F],   // Hangul Jamo
  [0x2E80, 0x303E],   // CJK radicals · Kangxi · CJK symbols & punctuation （、。「」…）
  [0x3041, 0x33FF],   // Hiragana · Katakana · enclosed CJK
  [0x3400, 0x4DBF],   // CJK Ext A
  [0x4E00, 0x9FFF],   // CJK Unified Ideographs
  [0xA000, 0xA4CF],   // Yi
  [0xAC00, 0xD7A3],   // Hangul syllables
  [0xF900, 0xFAFF],   // CJK compatibility ideographs
  [0xFE30, 0xFE4F],   // CJK compatibility forms
  [0xFF00, 0xFF60],   // Fullwidth forms （！？（）　…）
  [0xFFE0, 0xFFE6],   // Fullwidth signs
  [0x20000, 0x3FFFD], // CJK Ext B+ (supplementary planes)
];
function charWidth(cp) { for (const [a, b] of WIDE) if (cp >= a && cp <= b) return 2; return 1; }
function dispWidth(s) { let w = 0; for (const ch of String(s)) w += charWidth(ch.codePointAt(0)); return w; }

const isTableLine = (l) => /^[ \t]*\|.*\|[ \t]*$/.test(l);
const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSepRow = (cells) => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.trim()));

// Parse a contiguous block of table source lines into { header, align, body, ncol } for rendering a real
// <table>. Returns null if it isn't a valid table (2nd line must be the |---| separator). Used by the 編輯-mode
// table widget (table-view.js) — the browser then measures real glyph widths, so CJK columns align regardless
// of font (the fill-to-fit escape from the space-quantum problem).
function parseTable(lines) {
  const rows = lines.map(splitRow);
  if (rows.length < 2 || !isSepRow(rows[1])) return null;
  const ncol = Math.max(...rows.map((r) => r.length));
  const align = [];
  for (let i = 0; i < ncol; i++) { const t = (rows[1][i] || '').trim(); const l = t.startsWith(':'), r = t.endsWith(':'); align[i] = (l && r) ? 'center' : r ? 'right' : 'left'; }
  return { header: rows[0], align, body: rows.slice(2), ncol };
}

// Format ONE contiguous table block (source lines) → aligned lines; null if it isn't a real table.
function formatBlock(lines) {
  if (lines.length < 2) return null;
  const rows = lines.map(splitRow);
  if (!isSepRow(rows[1])) return null;                       // 2nd line MUST be the |---| separator
  const ncol = Math.max(...rows.map((r) => r.length));
  const align = [];
  for (let i = 0; i < ncol; i++) { const t = (rows[1][i] || '').trim(); const l = t.startsWith(':'), r = t.endsWith(':'); align[i] = (l && r) ? 'c' : r ? 'r' : 'l'; }
  const w = [];
  for (let i = 0; i < ncol; i++) { let mx = 3; rows.forEach((r, ri) => { if (ri !== 1) mx = Math.max(mx, dispWidth(r[i] || '')); }); w[i] = mx; }
  const pad = (text, width, a) => {
    const gap = width - dispWidth(text); if (gap <= 0) return text;
    if (a === 'r') return ' '.repeat(gap) + text;
    if (a === 'c') { const left = gap >> 1; return ' '.repeat(left) + text + ' '.repeat(gap - left); }
    return text + ' '.repeat(gap);
  };
  return rows.map((r, ri) => {
    if (ri === 1) return '| ' + w.map((width, i) => { const d = '-'.repeat(width); return align[i] === 'c' ? ':' + d.slice(2) + ':' : align[i] === 'r' ? d.slice(1) + ':' : d; }).join(' | ') + ' |';
    return '| ' + w.map((width, i) => pad(r[i] || '', width, align[i])).join(' | ') + ' |';
  });
}

// ---- whole-block table transforms (pure → unit-tested). Each takes a block's source lines and returns new
// ones, already re-aligned by formatBlock, or null when the input is not a table / the move is impossible.

// Split a block into head / sep / body cell arrays. Every row is padded to the block's column count, so a
// ragged hand-typed table can still be sorted or reordered instead of silently refusing.
function tableCells(lines) {
  const rows = lines.map(splitRow);
  if (rows.length < 2 || !isSepRow(rows[1])) return null;
  const ncol = Math.max(...rows.map((r) => r.length));
  const pad = (r, fill) => { const c = r.slice(); while (c.length < ncol) c.push(fill); return c; };
  return { head: pad(rows[0], ''), sep: pad(rows[1], '---'), body: rows.slice(2).map((r) => pad(r, '')), ncol };
}
function renderCells(tc) {
  const out = [tc.head, tc.sep, ...tc.body].map((cells) => '| ' + cells.join(' | ') + ' |');
  return formatBlock(out) || out;                                   // every transform leaves the source aligned
}

// Text comparison for a table sort, split out from the sort itself for one reason: `coll` is a PARAMETER, so
// a test can pass null and actually execute the no-Intl path. Left inline, that branch was unreachable from
// any test on any runtime we run tests on — a fallback nobody has ever seen run is a wish, not a fallback.
function tableCollator() {
  return (typeof Intl !== 'undefined' && Intl.Collator) ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
}
function cmpCells(x, y, coll) {
  if (coll) { const c = coll.compare(x, y); if (c) return c; }
  const a = x.toLowerCase(), b = y.toLowerCase();   // case-insensitive first, so 'Zebra' does not sort before 'apple'
  return a < b ? -1 : a > b ? 1 : (x < y ? -1 : x > y ? 1 : 0);
}

// Sort the BODY rows by one column; the header and the |---| separator never move. Numeric when every
// non-empty value in the column looks like a number, so 10 lands after 9 — which is most of the reason to
// have a sort at all. Empty cells sink to the bottom in BOTH directions (an empty cell is not a small value),
// and the sort is stable, so re-sorting a column you already sorted is a no-op.
//   Collation: Intl.Collator when the runtime has one (it gives zh/ja readers a sane order for their own
//   script), falling back to a case-insensitive code-point compare. The fallback is not decoration — a
//   comparison that only works when full ICU happens to be present is the kind of "MUST match" claim nothing
//   checks, and this way both paths are the same function's responsibility.
function sortTableBlock(lines, col, desc) {
  const tc = tableCells(lines);
  if (!tc || col < 0 || col >= tc.ncol) return null;
  const key = (r) => String(r[col] || '').trim();
  const filled = tc.body.map(key).filter((s) => s !== '');
  const numeric = filled.length > 0 && filled.every((s) => /^[-+]?\d[\d,]*(?:\.\d+)?%?$/.test(s));
  const num = (s) => parseFloat(s.replace(/[,%]/g, ''));
  const coll = tableCollator();
  // No index tiebreak: Array.prototype.sort has been REQUIRED to be stable since ES2019, so decorating the
  // rows with their original position bought nothing — a mutation that removed the tiebreak could not be made
  // to fail. The stability test stays; it now guards the property, not a redundant line of ours.
  tc.body = tc.body.slice().sort((ra, rb) => {
    const x = key(ra), y = key(rb);
    if (x === '' || y === '') return x === y ? 0 : (x === '' ? 1 : -1);
    const c = numeric ? (num(x) - num(y)) : cmpCells(x, y, coll);
    return desc ? -c : c;
  });
  return renderCells(tc);
}

// Move a column sideways. The separator cell travels WITH it, so a right-aligned column stays right-aligned
// after the move — the alignment belongs to the column, not to the position.
function moveTableColumn(lines, col, delta) {
  const tc = tableCells(lines);
  const to = col + delta;
  if (!tc || col < 0 || col >= tc.ncol || to < 0 || to >= tc.ncol) return null;
  const shift = (r) => { const c = r.slice(); c.splice(to, 0, c.splice(col, 1)[0]); return c; };
  tc.head = shift(tc.head); tc.sep = shift(tc.sep); tc.body = tc.body.map(shift);
  return { lines: renderCells(tc), index: to };
}

// Move a body row up or down. `row` is an index into the block's LINES (0 = header, 1 = separator), and
// neither of those is movable — returns null rather than quietly doing something else.
function moveTableRow(lines, row, delta) {
  const tc = tableCells(lines);
  const from = row - 2, to = from + delta;
  if (!tc || from < 0 || from >= tc.body.length || to < 0 || to >= tc.body.length) return null;
  const b = tc.body.slice(); b.splice(to, 0, b.splice(from, 1)[0]); tc.body = b;
  return { lines: renderCells(tc), index: to + 2 };
}

// Re-align every contiguous markdown table block; non-table text is untouched. Idempotent.
function formatTables(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (isTableLine(lines[i])) {
      let j = i; const block = [];
      while (j < lines.length && isTableLine(lines[j])) block.push(lines[j++]);
      const fixed = formatBlock(block);
      if (fixed) { out.push(...fixed); i = j - 1; continue; }
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

// table-view — in 編輯 mode, restyle a contiguous markdown table block so it LOOKS like a real grid with
// aligned columns — CJK included — and lets you EDIT INSIDE the grid safely, without touching marktile core.
//
// Why restyle the line <div>s IN PLACE (not insert a <table> widget): marktile's text model assumes the editor
// root's children ARE the lines (getText joins child textContent; caret math + lineCount walk the same children).
// So we keep the SAME line divs and only regroup each line's inner nodes (cells/pipes into spans) + CSS. Every
// line's textContent stays byte-identical → round-trip exact, no core change.
//
// In-grid editing rests on three legs (the "locked markers" design):
//   1. LOCKED MARKERS — every hidden pipe span is contenteditable=false (only in 編輯 mode), so the caret can't
//      enter the syntax and a stray Backspace can't eat a pipe: the table structure is physically indestructible.
//      A beforeinput guard additionally blocks deletions whose target range would cross a pipe / cell / row
//      boundary. Typed characters flow into the cell's text node → the markdown is naturally correct.
//   2. SYNC RE-WRAP — marktile rebuilds a line's innerHTML after edits (wiping our spans). MutationObserver
//      callbacks are microtasks that run BEFORE paint, so re-wrapping synchronously in the callback (with caret
//      capture/restore around the surgery) is flicker-free by construction. No debounce.
//   3. TABLE KEYS, two dialects:
//      · markdown 魂 — typing '|' in a cell SPLITS THE COLUMN there (the syntax IS the command; the split is
//        propagated to every row so the table stays rectangular).
//      · Word 遺毒 — Tab hops cells and GROWS A ROW from the last cell; Enter inserts a row below; right-click
//        opens insert/delete column/row — the habits real (non-technical) operators arrive with.
// 調味/原味 show raw source: pipes visible and fully editable there (locks are preview-mode-only).

// Undo our wrapping: restore marktile's inline nodes + literal | text and drop our classes (idempotent base).
function unwrapLine(line) {
  if (!line.querySelector('.ej-cell, .ej-pipe')) { line.classList.remove('ej-trow', 'ej-thead', 'ej-tsep'); return; }
  line.querySelectorAll('.ej-pipe').forEach((p) => p.replaceWith(document.createTextNode('|')));
  line.querySelectorAll('.ej-cell').forEach((c) => { while (c.firstChild) c.parentNode.insertBefore(c.firstChild, c); c.remove(); });
  line.normalize();
  line.classList.remove('ej-trow', 'ej-thead', 'ej-tsep');
}

// Group ONE highlighted line into cell/pipe spans, PRESERVING marktile's inline nodes (tg-b / tg-mk / tg-link)
// inside each cell — bold/italic render and their markers hide like everywhere else in 編輯 mode, textContent
// byte-identical. Splits at top-level '|' text only; tags each cell with its column alignment.
function wrapLine(line, aligns) {
  unwrapLine(line);
  const cells = []; let cur = [];
  for (const node of [...line.childNodes]) {
    if (node.nodeType === 3 && node.nodeValue.indexOf('|') >= 0) {
      const segs = node.nodeValue.split('|');
      for (let i = 0; i < segs.length; i++) { if (i > 0) { cells.push(cur); cur = []; } if (segs[i] !== '') cur.push(document.createTextNode(segs[i])); }
    } else { cur.push(node); }
  }
  cells.push(cur);
  const frag = document.createDocumentFragment();
  cells.forEach((nodes, ci) => {
    if (ci > 0) { const p = document.createElement('span'); p.className = 'ej-pipe'; p.textContent = '|'; frag.appendChild(p); }
    if (ci === 0 || ci === cells.length - 1) { nodes.forEach((n) => frag.appendChild(n)); return; }   // outer | … | border, no cell
    const c = document.createElement('span'); c.className = 'ej-cell';
    const a = aligns && aligns[ci - 1]; if (a && a !== 'left') c.dataset.a = a;
    nodes.forEach((n) => c.appendChild(n)); frag.appendChild(c);
  });
  line.textContent = '';   // drop the leftover original text nodes (the '|'-bearing ones were copied, not moved)
  line.appendChild(frag);
}

// caret char-offset within a line (textContent positions) — captured/restored around our DOM surgery
function caretOffset(line) {
  const s = getSelection(); if (!s || !s.rangeCount) return null;
  const r = s.getRangeAt(0); if (!line.contains(r.startContainer)) return null;
  const pre = document.createRange(); pre.selectNodeContents(line); pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}
function setCaret(line, off) {
  let rem = off; const w = document.createTreeWalker(line, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) {
    const len = n.nodeValue.length;
    const inPipe = n.parentElement && n.parentElement.closest('.ej-pipe');   // locked+hidden — the caret can't live there;
    if (rem <= len && !inPipe) { const r = document.createRange(); r.setStart(n, rem); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return; }
    if (rem <= len && inPipe) { rem = 0; continue; }                          // boundary inside a pipe → start of the NEXT visible node
    rem -= len;
  }
}

const nthPipe = (t, n) => { let c = -1; for (let k = 0; k < t.length; k++) { if (t[k] === '|') c++; if (c === n) return k; } return -1; };

function decorateTables(root, ctrl, gateClass) {
  const inPreview = () => root.classList.contains(gateClass || 'tugtile-preview');
  const lineOf = (node) => { if (!node || !root.contains(node)) return null; const el = node.nodeType === 3 ? node.parentElement : node; return el && el.closest ? el.closest('.tg-line') : null; };
  const caretLineEl = () => { const s = getSelection(); return s && s.rangeCount ? lineOf(s.anchorNode) : null; };
  const T = (k, fb) => { try { const s = (typeof t === 'function') ? t(k) : null; return (s != null && s !== k) ? s : fb; } catch (e) { return fb; } };

  const setLocks = (line, on) => line.querySelectorAll('.ej-pipe').forEach((p) => { if (on) p.setAttribute('contenteditable', 'false'); else p.removeAttribute('contenteditable'); });

  const blockRows = (line) => { let r = line; while (r.previousElementSibling && r.previousElementSibling.classList.contains('ej-trow')) r = r.previousElementSibling;
    const rows = []; for (; r && r.classList.contains('ej-trow'); r = r.nextElementSibling) rows.push(r); return rows; };
  const cellsOf = (rows) => rows.filter((x) => !x.classList.contains('ej-tsep')).flatMap((x) => [...x.querySelectorAll('.ej-cell')]);

  // WebKit doesn't propagate a row's content-width change to the SIBLING rows of the anonymous table box (the
  // header column stays stuck until you type in it). Cure: kick every row of the edited block out of table
  // context and back (style-only, no DOM mutation → selection survives), forcing the anonymous table to be
  // rebuilt with fresh column widths. Runs inside the MO microtask = before paint → invisible.
  const relayout = (block) => {
    block.forEach((l) => { l.style.display = 'block'; });
    void block[0].offsetWidth;   // flush layout while the rows are out of the table
    block.forEach((l) => { l.style.display = ''; });
  };

  const scan = () => {
    obs.disconnect();
    try {
      const cl = caretLineEl(); const clOff = cl ? caretOffset(cl) : null; let touchedCaret = false;
      const lock = inPreview();
      // Lines the block scan marked as code or frontmatter are excluded: a `| a | b |` inside a ```
      // fence is a string in someone's shell script, and gridding it would rewrite what they typed.
      const isPlain = (l) => !/\btg-(cblock|cfence|fm|fmfence)\b/.test(l.className);
      const lines = [...root.querySelectorAll('.tg-line')].filter(isPlain);
      let i = 0;
      while (i < lines.length) {
        if (isTableLine(lines[i].textContent)) {
          let j = i; const block = [];
          while (j < lines.length && isTableLine(lines[j].textContent)) block.push(lines[j++]);
          const parsed = parseTable(block.map((l) => l.textContent));
          if (parsed) {
            block.forEach((l, k) => {
              if (!l.classList.contains('ej-trow')) { wrapLine(l, parsed.align); l.classList.add('ej-trow'); if (k === 0) l.classList.add('ej-thead'); if (k === 1) l.classList.add('ej-tsep'); if (l === cl) touchedCaret = true; }
              setLocks(l, lock);
            });
            if (lock && block.indexOf(cl) >= 0) relayout(block);   // typing in this block → resync sibling-row column widths
          }
          i = j; continue;
        }
        if (lines[i].classList.contains('ej-trow')) { if (lines[i] === cl) touchedCaret = true; unwrapLine(lines[i]); }   // edited out of a table → restore
        i++;
      }
      if (touchedCaret && cl && clOff != null) setCaret(cl, clOff);   // our surgery moved the caret's nodes — put it back
    } finally { obs.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] }); }
  };

  // ---- whole-document table transforms (one ctrl.setText each = one undo step; caret restored after) ----
  const docEdit = (mutate) => {
    const all = [...root.querySelectorAll('.tg-line')];
    const doc = ctrl.rawValue().split('\n');
    const caret = mutate(all, doc) || {};   // mutate doc in place; returns {caretLine, caretOff}
    ctrl.setText(doc.join('\n'));
    if (caret.caretLine != null) { const fresh = root.querySelectorAll('.tg-line')[caret.caretLine]; if (fresh) setCaret(fresh, caret.caretOff || 0); }
  };

  // cell index of a char offset in a row's text (0-based; -1 = before the leading border pipe)
  const cellIndexAt = (t, off) => { let ci = -1; for (let k = 0; k < off; k++) if (t[k] === '|') ci++; return ci; };

  // insert an empty column so the NEW cell sits at index `at` in every row of `line`'s block
  const insertColumn = (line, at, caretRow) => docEdit((all, doc) => {
    const rows = blockRows(line); let out = null;
    for (const r of rows) {
      const ix = all.indexOf(r); const t = doc[ix];
      const cell = r.classList.contains('ej-tsep') ? ' --- |' : '  |';
      const open = nthPipe(t, at);                                  // pipe that OPENS index `at`
      const pos = open < 0 ? t.length : open + 1;
      doc[ix] = t.slice(0, pos) + cell + t.slice(pos);
      if (r === (caretRow || line)) out = { caretLine: ix, caretOff: pos + 1 };
    }
    return out;
  });

  const deleteColumn = (line, ci) => docEdit((all, doc) => {
    const rows = blockRows(line); let out = null;
    for (const r of rows) {
      const ix = all.indexOf(r); const t = doc[ix];
      const open = nthPipe(t, ci), close = nthPipe(t, ci + 1);
      if (open < 0) continue;
      doc[ix] = close < 0 ? t.slice(0, open + 1) : t.slice(0, open) + t.slice(close);
      if (r === line) out = { caretLine: ix, caretOff: Math.max(1, open) };
    }
    return out;
  });

  const insertRow = (line, below) => docEdit((all, doc) => {
    const rows = blockRows(line);
    const parsed = parseTable(rows.map((l) => l.textContent)); if (!parsed) return null;
    // from the header, "below" means below the |---| separator; "above" the header is not a table place
    let anchor = line;
    if (line.classList.contains('ej-thead')) anchor = below ? rows[1] : rows[0];
    const ix = all.indexOf(anchor) + (below ? 1 : 0);
    doc.splice(ix, 0, '|' + '  |'.repeat(parsed.ncol));
    return { caretLine: ix, caretOff: 2 };
  });

  const deleteRow = (line) => docEdit((all, doc) => {
    const ix = all.indexOf(line);
    doc.splice(ix, 1);
    return { caretLine: Math.max(0, ix - 1), caretOff: 2 };
  });

  // Whole-block rewrite: hand the block's source lines to a pure transform and write the result back. The
  // transforms never change the LINE COUNT, so the block's document indices stay valid and the caret can be
  // parked on whichever line the transform says the moved thing ended up on.
  const blockEdit = (line, transform) => docEdit((all, doc) => {
    const rows = blockRows(line);
    const ixs = rows.map((r) => all.indexOf(r));
    if (ixs.some((i) => i < 0)) return null;
    const res = transform(ixs.map((i) => doc[i]));
    if (!res) return null;
    const lines = Array.isArray(res) ? res : res.lines;
    const at = Array.isArray(res) || res.index == null ? rows.indexOf(line) : res.index;
    lines.forEach((txt, k) => { if (ixs[k] != null) doc[ixs[k]] = txt; });
    return { caretLine: ixs[at], caretOff: 2 };
  });

  // ---- Word-habit context menu: right-click a cell → insert/delete column/row ----
  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  document.addEventListener('click', closeMenu, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); }, true);
  root.addEventListener('contextmenu', (e) => {
    if (!inPreview() || !ctrl) return;
    const cellEl = e.target && e.target.closest ? e.target.closest('.ej-cell') : null; if (!cellEl) return;
    const line = cellEl.closest('.tg-line'); if (!line || !line.classList.contains('ej-trow')) return;
    e.preventDefault(); closeMenu();
    const ci = [...line.querySelectorAll('.ej-cell')].indexOf(cellEl);
    const rows = blockRows(line);
    const ncol = (parseTable(rows.map((l) => l.textContent)) || { ncol: 1 }).ncol;
    const isHead = line.classList.contains('ej-thead');
    menu = document.createElement('div'); menu.className = 'ej-tblmenu';
    const item = (label, fn, disabled) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (disabled) b.disabled = true;
      b.onmousedown = (ev) => ev.preventDefault();
      b.onclick = (ev) => { ev.stopPropagation(); closeMenu(); fn(); }; menu.appendChild(b); return b; };
    item(T('TBL_INS_COL_L', '在左方插入欄'), () => insertColumn(line, ci, line));
    item(T('TBL_INS_COL_R', '在右方插入欄'), () => insertColumn(line, ci + 1, line));
    menu.appendChild(document.createElement('hr'));
    item(T('TBL_INS_ROW_A', '在上方插入列'), () => insertRow(line, false), isHead);
    item(T('TBL_INS_ROW_B', '在下方插入列'), () => insertRow(line, true));
    menu.appendChild(document.createElement('hr'));
    item(T('TBL_DEL_COL', '刪除欄'), () => deleteColumn(line, ci), ncol <= 1);
    item(T('TBL_DEL_ROW', '刪除列'), () => deleteRow(line), isHead);
    // Reordering and sorting: the two things a grid can do that a pile of pipes cannot. Each is disabled at the
    // edge it cannot go past, and the header/separator rows are never movable.
    const ri = rows.indexOf(line);
    menu.appendChild(document.createElement('hr'));
    item(T('TBL_MOV_COL_L', '將此欄左移'), () => blockEdit(line, (ls) => moveTableColumn(ls, ci, -1)), ci <= 0);
    item(T('TBL_MOV_COL_R', '將此欄右移'), () => blockEdit(line, (ls) => moveTableColumn(ls, ci, +1)), ci >= ncol - 1);
    item(T('TBL_MOV_ROW_U', '將此列上移'), () => blockEdit(line, (ls) => moveTableRow(ls, ri, -1)), ri <= 2);
    item(T('TBL_MOV_ROW_D', '將此列下移'), () => blockEdit(line, (ls) => moveTableRow(ls, ri, +1)), ri < 2 || ri >= rows.length - 1);
    menu.appendChild(document.createElement('hr'));
    item(T('TBL_SORT_ASC', '依此欄排序（遞增）'), () => blockEdit(line, (ls) => sortTableBlock(ls, ci, false)), rows.length <= 3);
    item(T('TBL_SORT_DESC', '依此欄排序（遞減）'), () => blockEdit(line, (ls) => sortTableBlock(ls, ci, true)), rows.length <= 3);
    item(T('TBL_ALIGN', '對齊表格原始碼'), () => blockEdit(line, (ls) => formatBlock(ls)));
    menu.style.left = e.clientX + 'px'; menu.style.top = e.clientY + 'px';
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();   // keep on screen
    if (r.right > innerWidth) menu.style.left = (innerWidth - r.width - 8) + 'px';
    if (r.bottom > innerHeight) menu.style.top = (e.clientY - r.height) + 'px';
  });

  // ---- table keys (capture phase: marktile's Tab/Enter handlers must not see these) ----
  root.addEventListener('keydown', (e) => {
    if (!inPreview()) return;
    const line = caretLineEl(); if (!line || !line.classList.contains('ej-trow')) return;
    if (e.key === 'Tab') {
      e.preventDefault(); e.stopPropagation();
      const rows = blockRows(line);
      const cells = cellsOf(rows);
      const s = getSelection(); const cur = s.rangeCount ? (s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode).closest('.ej-cell') : null;
      const ix = cells.indexOf(cur);
      if (!e.shiftKey && ix === cells.length - 1) { insertRow(rows[rows.length - 1], true); return; }   // Word habit: Tab past the end grows a row
      const next = cells[(ix < 0 ? 0 : ix + (e.shiftKey ? -1 : 1) + cells.length) % cells.length];
      if (next) { const rg = document.createRange(); rg.selectNodeContents(next); rg.collapse(false); s.removeAllRanges(); s.addRange(rg); }
      return;
    }
    if (e.key === 'Enter') {   // Enter in a cell = NEW ROW below (a raw newline would split the row)
      e.preventDefault(); e.stopPropagation();
      if (ctrl) insertRow(line, true);
      return;
    }
  }, true);

  // ---- typing '|' in a cell = SPLIT THE COLUMN here (the syntax IS the command) ----
  // In plain markdown a pipe splits that one row; in the grid we propagate the split to EVERY row of the
  // block (empty cell after the same column; the |---| row gets a matching ---), keeping the table rectangular.
  root.addEventListener('beforeinput', (e) => {
    if (!inPreview() || !ctrl || e.inputType !== 'insertText' || e.data !== '|') return;
    const line = caretLineEl(); if (!line || !line.classList.contains('ej-trow')) return;
    const s = getSelection(); if (!s.rangeCount || !s.isCollapsed) return;
    const anchorEl = s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode;
    if (!anchorEl.closest('.ej-cell')) return;   // only inside a cell (not the outer | borders)
    e.preventDefault(); e.stopPropagation();
    const off = caretOffset(line); if (off == null) return;
    const ci = cellIndexAt(line.textContent, off);
    docEdit((all, doc) => {
      const rows = blockRows(line); let out = null;
      for (const r of rows) {
        const ix = all.indexOf(r); const t = doc[ix];
        if (r === line) { doc[ix] = t.slice(0, off) + '|' + t.slice(off); out = { caretLine: ix, caretOff: off + 1 }; continue; }
        const close = nthPipe(t, ci + 1);                                               // closing pipe of cell ci
        const cell = r.classList.contains('ej-tsep') ? ' --- |' : '  |';
        doc[ix] = close < 0 ? t + cell : t.slice(0, close + 1) + cell + t.slice(close + 1);
      }
      return out;
    });
  }, true);

  // ---- deletion guard: block any delete whose target range would cross a pipe / cell / row boundary ----
  root.addEventListener('beforeinput', (e) => {
    if (!inPreview() || !e.inputType || !e.inputType.startsWith('delete')) return;
    const line = caretLineEl(); const inTable = line && line.classList.contains('ej-trow');
    const ranges = e.getTargetRanges ? e.getTargetRanges() : [];
    if (!ranges.length) { return; }
    for (const r of ranges) {
      const sl = lineOf(r.startContainer), el = lineOf(r.endContainer);
      if (!(sl && sl.classList.contains('ej-trow')) && !(el && el.classList.contains('ej-trow')) && !inTable) continue;
      if (sl !== el) { e.preventDefault(); return; }                                        // crossing a row boundary dissolves the table
      const sC = (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer);
      const eC = (r.endContainer.nodeType === 3 ? r.endContainer.parentElement : r.endContainer);
      if (sC.closest('.ej-pipe') || eC.closest('.ej-pipe')) { e.preventDefault(); return; }  // touching a locked marker
      const c1 = sC.closest('.ej-cell'), c2 = eC.closest('.ej-cell');
      if (c1 !== c2) { e.preventDefault(); return; }                                         // crossing a cell boundary
    }
  }, true);

  const obs = new MutationObserver(scan);   // microtask → re-wrap runs BEFORE paint → flicker-free by construction
  scan();
  return obs;
}

// Inline image thumbnails — show the picture beside its still-editable source line. The source text stays in the
// line (textContent untouched → round-trip exact, the markdown model is unaffected); a contenteditable=false <img>
// is appended as a sibling. resolveSrc(raw) maps the matched path/url to a real displayable src, or null to skip —
// the web host passes web URLs through, marktile resolves vault paths (and returns null for non-images). marktile
// rebuilds the line divs on every keystroke, so a debounced MutationObserver re-applies. Shared by both hosts;
// this is the first step of Rendered "growing" — the same widget pattern later carries math / callouts.
function decorateImages(root, resolveSrc) {
  const resolve = resolveSrc || ((u) => u);
  const scan = () => {
    root.querySelectorAll('.tg-line').forEach((line) => {
      const txt = line.textContent || '';
      const m = txt.match(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/) || txt.match(/!\[[^\]]*\]\(([^)]+)\)/) || txt.match(/<img[^>]+src=["']([^"']+)["']/);
      const url = m ? resolve(m[1]) : null;
      const cur = line.querySelector(':scope > img.ej-inlimg');
      if (url) {
        if (!cur || cur.dataset.u !== url) {
          if (cur) cur.remove();
          const im = document.createElement('img');
          im.className = 'ej-inlimg'; im.contentEditable = 'false'; im.draggable = false; im.dataset.u = url; im.src = url;
          line.appendChild(im); line.classList.add('ej-hasimg');
        }
      } else if (cur) { cur.remove(); line.classList.remove('ej-hasimg'); }
    });
  };
  let t; const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 80); });
  obs.observe(root, { childList: true, subtree: true, characterData: true });
  scan();
  return obs;
}

// Table of contents — the ONE shared TOC for marktile (Obsidian) and the web host. Lists H1–H3 (tocHeadings),
// click to jump, drag to reorder whole sections (moveSection via Sortable). One visual (.marktile-toc* classes in
// the shared sheet). Hosts pass: mount (container), ctrl (editor controller), labels {title, empty} (each host
// resolves its own i18n), and optional Sortable (defaults to window.Sortable), onReorder (after a drag),
// onNavigate (after a click — e.g. marktile closes on phone), anchorScroll (selector whose offsetTop the panel
// pins below, for Obsidian's in-flow toolbar; the web host anchors via CSS), sortableOptions (extra Sortable opts, e.g.
// marktile's mobile touch tuning). Returns { toggle, refresh, destroy }.
function wireToc(opts) {
  const { mount, ctrl, labels, onReorder, onNavigate, anchorScroll, sortableOptions } = opts;
  const Sortable = opts.Sortable || (typeof window !== 'undefined' ? window.Sortable : null);
  let open = false, panel = null, debT = null, sortable = null;
  const lab = labels || {};
  const ensure = () => { if (panel && panel.isConnected) return; panel = document.createElement('div'); panel.className = 'marktile-toc'; mount.appendChild(panel); };
  const killSortable = () => { if (sortable) { try { sortable.destroy(); } catch (e) {} sortable = null; } };
  function build() {
    const ed = mount.querySelector('.tugtile-ed-rich'); if (!ed || !panel) return;
    if (anchorScroll) { const s = mount.querySelector(anchorScroll); if (s) panel.style.top = s.offsetTop + 'px'; }   // pin below the in-flow toolbar (Obsidian)
    killSortable();
    panel.innerHTML = '';
    const ti = document.createElement('div'); ti.className = 'marktile-toc-title'; ti.textContent = lab.title || ''; panel.appendChild(ti);
    const list = document.createElement('div'); list.className = 'marktile-toc-list'; panel.appendChild(list);
    const lineEls = ed.querySelectorAll('.tg-line'); const heads = tocHeadings(ctrl ? ctrl.rawValue() : '');
    if (!heads.length) { const e = document.createElement('div'); e.className = 'marktile-toc-empty'; e.textContent = lab.empty || ''; list.appendChild(e); return; }
    heads.forEach((h) => {
      const it = document.createElement('div'); it.className = 'marktile-toc-item marktile-toc-l' + h.level; it.textContent = h.text || '—';
      it.onclick = () => { const el = lineEls[h.line]; if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); if (onNavigate) onNavigate(); };
      list.appendChild(it);
    });
    if (Sortable) try {
      sortable = new Sortable(list, Object.assign({
        draggable: '.marktile-toc-item', animation: 150,
        ghostClass: 'marktile-toc-item--ghost', chosenClass: 'marktile-toc-item--chosen',
        onEnd: (ev) => {
          const cur = ctrl.rawValue(); const next = moveSection(cur, ev.oldIndex, ev.newIndex);
          if (next !== cur && ctrl.setText) { ctrl.setText(next); if (onReorder) onReorder(); }
          setTimeout(() => { if (open) build(); }, 0);   // deferred: don't destroy the active Sortable from inside its own onEnd
        },
      }, sortableOptions || {}));
    } catch (e) {}
  }
  return {
    toggle(force) { open = (force === undefined) ? !open : !!force; if (open) { ensure(); build(); } mount.classList.toggle('marktile-toc-open', open); },
    refresh() { if (!open) return; clearTimeout(debT); debT = setTimeout(() => { if (open) build(); }, 250); },
    isOpen() { return open; },
    destroy() { killSortable(); panel = null; open = false; },
  };
}

// The editor "rig" — the full marktile experience any host equips on a mounted editor: the Seasoned/Rendered/Plain
// mode cycle (the class on `mount`), in-grid tables, inline images, and the TOC, all wired once. Hosts pass the
// mount + controller + their host-specific hooks (resolveSrc image resolver, toc options, which modes are enabled,
// an initialMode to restore across a rebuild) and render their OWN viewcycle button by calling cycleMode()/
// currentMode(). One rig — equipped by MarktileView, TileEditModal and the web editor alike — so "the editor" is
// literally one thing everywhere it appears.
const EDITOR_MODES = [
  { key: 'seasoned', cls: '', icon: 'square-m', name: 'mtModeSeasoned' },
  { key: 'rendered', cls: 'tugtile-preview', icon: 'square-pen', name: 'mtModeRendered' },
  { key: 'plain', cls: 'tugtile-plain', icon: 'square-code', name: 'mtModePlain' },
];
// Rendered mode hides the literal `[ ]` / `[x]` and puts a box glyph in its place (styles.css,
// .tg-check::before). A box you can see but can't press is a half-finished affordance — so this wires
// the gesture everyone will try. Click the box, the SOURCE toggles; the glyph follows because it was
// only ever a view of the text.
// This lives in the core, not in a host: it is a capability, and the toolbar/behaviour surface is the
// core's single source. Every surface that renders the box gets the same click, and none of them grow
// their own version of it.
// Only active where the box is a glyph. In Seasoned/Plain the `[x]` is literal text the person edits
// directly, and stealing that click would fight normal caret placement.
function wireTaskToggle(mount, ctrl) {
  const onClick = (e) => {
    if (!mount.classList.contains('tugtile-preview')) return;
    const el = (e.target && e.target.nodeType === 1) ? e.target : (e.target && e.target.parentElement);
    const box = (el && el.closest) ? el.closest('.tg-check') : null;
    if (!box) return;
    const lineEl = box.closest('.tg-line');
    if (!lineEl) return;
    // .tg-line divs map 1:1 onto source lines, in order — the same mapping wireToc/moveSection rely on.
    const lines = Array.prototype.slice.call(mount.querySelectorAll('.tg-line'));
    const ix = lines.indexOf(lineEl);
    const src = ctrl.rawValue().split('\n');
    if (ix < 0 || ix >= src.length) return;
    const next = src[ix].replace(/^([ \t]*[-*][ \t])\[([ xX])\]/, (m, pre, mark) => pre + (mark === ' ' ? '[x]' : '[ ]'));
    if (next === src[ix]) return;   // not a task line after all — let the click through untouched
    e.preventDefault();
    e.stopPropagation();
    src[ix] = next;
    ctrl.setText(src.join('\n'));   // whole-document replace: undoable + fires onChange, the same path TOC reorder uses
  };
  mount.addEventListener('click', onClick, true);
  return { destroy() { try { mount.removeEventListener('click', onClick, true); } catch (e) {} } };
}

function equipEditor(opts) {
  const { mount, ctrl, enabledModes, resolveSrc, toc, saveImage } = opts;
  const onModes = () => { const md = enabledModes || {}; const on = EDITOR_MODES.filter((m) => md[m.key] !== false); return on.length ? on : EDITOR_MODES; };
  let ix = 0;
  if (opts.initialMode) { const i = onModes().findIndex((m) => m.key === opts.initialMode); if (i >= 0) ix = i; }
  const current = () => { const e = onModes(); return e[ix % e.length]; };
  const applyMode = () => {
    const m = current();
    mount.classList.toggle('marktile-grid', m.key !== 'plain');   // tables become a locked grid in Seasoned & Rendered
    mount.classList.toggle('tugtile-preview', m.cls === 'tugtile-preview');   // Rendered hides the markers
    mount.classList.toggle('tugtile-plain', m.cls === 'tugtile-plain');       // Plain = raw source
  };
  const tableObs = decorateTables(mount, ctrl, 'marktile-grid');
  const imgObs = resolveSrc ? decorateImages(mount, resolveSrc) : null;
  const tocCtl = toc ? wireToc(Object.assign({ mount, ctrl }, toc)) : null;
  const paste = saveImage ? wireImagePaste(mount, ctrl, saveImage) : null;
  const taskCtl = wireTaskToggle(mount, ctrl);   // Rendered-mode checkbox click → source toggle
  mount.classList.toggle('marktile-palette-color', !!opts.seasonedColor);   // Seasoned palette: accent (default) vs per-token colour; host passes the setting
  applyMode();
  return {
    currentMode: current,
    applyMode,
    cycleMode() { ix = (ix + 1) % onModes().length; applyMode(); },
    toc: tocCtl,
    destroy() { try { tableObs.disconnect(); } catch (e) {} if (imgObs) { try { imgObs.disconnect(); } catch (e) {} } if (tocCtl) tocCtl.destroy(); if (paste) paste.destroy(); if (taskCtl) taskCtl.destroy(); },
  };
}

// The editor control strip — viewcycle + lock in marktile's exact markup (.tugtile-headerctl), with OPTIONAL
// cancel/save buttons on the ends. marktile builds its own strip inside the hijacked Obsidian header; TileEditModal
// builds THIS one at the top of the modal, so tugtile's big editor reads as "marktile + ✕/✓" — one look, two
// placements. ctl: { cycleMode, currentMode, toggleLock, isLocked, brand, brandLocked, modeLabel, lockLabel,
// onCancel, cancelLabel, onSave, saveLabel }. Returns { el, refresh }.
function buildEditorCtl(parent, ctl) {
  const wrap = parent.createSpan({ cls: 'tugtile-headerctl' });
  const iconBtn = (icon, label, fn) => { const b = wrap.createEl('button', { cls: 'tugtile-iconbtn' }); setIcon(b.createSpan(), icon); b.setAttribute('aria-label', label || ''); b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(); }; return b; };
  if (ctl.onCancel) iconBtn('x', ctl.cancelLabel, ctl.onCancel);   // ✕ on the left (modal only)
  const vc = wrap.createSpan({ cls: 'tugtile-viewcycle' });
  vc.setAttribute('role', 'button'); vc.setAttribute('aria-label', ctl.modeLabel || '');
  vc.onclick = (e) => { e.preventDefault(); e.stopPropagation(); ctl.cycleMode(); refresh(); };
  wrap.createSpan({ cls: 'tugtile-sep', text: '·' });
  const lk = wrap.createSpan({ cls: 'tugtile-brand' });
  lk.setAttribute('role', 'button'); lk.setAttribute('aria-label', ctl.lockLabel || '');
  lk.onclick = (e) => { e.preventDefault(); e.stopPropagation(); ctl.toggleLock(); refresh(); };
  if (ctl.onSave) iconBtn('check', ctl.saveLabel, ctl.onSave);   // ✓ on the right (modal only)
  // ctl.stableWidth — opt-in, because whether this matters is a question about PLACEMENT, and placement
  // belongs to the surface. Both labels change width in use (the mode name cycles, the brand swaps to its
  // locked form), which only hurts where the strip shares a flex row with something centred: the macOS
  // host, where every mode switch nudged the whole toolbar. In Obsidian's header it costs nothing, so it
  // is not imposed there.
  //
  // The reservation goes on the WRAPPER — which has no background — with the contents pinned right. Put
  // it on the label instead and the mode pill itself stretches, leaving the text marooned in a wide box.
  // This way the pill hugs its word, the separator/brand/lock never move, and only the pill's left edge
  // travels through empty space.
  //
  // Measured, never hard-coded: 'Seasoned', 'アジツケ' and '調味' are three different widths, and a px that
  // fits one clips or pads the others.
  let reserved = false;
  function reserveWidth(nameEl, brandEl) {
    if (reserved || !ctl.stableWidth || !wrap.isConnected) return;   // detached at build time → the first connected refresh sizes it
    const name0 = nameEl.textContent, brand0 = brandEl.textContent;
    let max = 0;
    EDITOR_MODES.forEach((m) => {          // every name × both brand forms: the widest COMBINATION, not the
      nameEl.textContent = t(m.name);      // widest of each measured apart
      [ctl.brand || '', ctl.brandLocked || ''].forEach((bd) => {
        brandEl.textContent = bd;
        max = Math.max(max, wrap.offsetWidth);
      });
    });
    nameEl.textContent = name0; brandEl.textContent = brand0;
    if (max > 0) { wrap.style.minWidth = max + 'px'; wrap.style.justifyContent = 'flex-end'; reserved = true; }
  }

  function refresh() {   // populate unconditionally — the strip is built detached (before prepend), so an isConnected gate would skip the first paint
    vc.empty(); const m = ctl.currentMode(); setIcon(vc.createSpan({ cls: 'tugtile-viewcycle-icon' }), m.icon);
    const nameEl = vc.createSpan({ cls: 'tugtile-viewcycle-name', text: t(m.name) });
    lk.empty(); const locked = ctl.isLocked && ctl.isLocked();
    const brandEl = lk.createSpan({ cls: 'tugtile-brand-text', text: locked ? (ctl.brandLocked || '') : (ctl.brand || '') });
    setIcon(lk.createSpan({ cls: 'tugtile-lock-icon' }), locked ? 'lock' : 'lock-open');
    reserveWidth(nameEl, brandEl);
  }
  refresh();
  return { el: wrap, refresh };
}

// Image paste/drop — without this, the browser shoves a base64 <img> into the contenteditable that getText() can't
// see, so a pasted picture silently vanishes on the next render. Here we intercept image paste/drop, hand the blob
// to the host's saveImage(blob) → markdown link (Obsidian: save to the vault attachment folder; web host: upload),
// and insert that link at the caret — then decorateImages shows the thumbnail. Returns { destroy }.
function wireImagePaste(root, ctrl, saveImage) {
  const handle = async (files) => {
    for (const f of files) {
      if (!f || !f.type || f.type.indexOf('image/') !== 0) continue;
      try { const link = await saveImage(f); if (link) ctrl.insertText(link); } catch (e) {}
    }
  };
  const onPaste = (e) => {
    const items = e.clipboardData && e.clipboardData.items; const files = [];
    if (items) for (const it of items) { if (it.kind === 'file') { const f = it.getAsFile(); if (f && f.type && f.type.indexOf('image/') === 0) files.push(f); } }
    if (files.length) { e.preventDefault(); e.stopPropagation(); handle(files); }
  };
  const onDrop = (e) => {
    const fl = e.dataTransfer && e.dataTransfer.files; const imgs = fl ? [...fl].filter((f) => f.type && f.type.indexOf('image/') === 0) : [];
    if (imgs.length) { e.preventDefault(); e.stopPropagation(); handle(imgs); }
  };
  root.addEventListener('paste', onPaste, true);
  root.addEventListener('drop', onDrop, true);
  return { destroy() { root.removeEventListener('paste', onPaste, true); root.removeEventListener('drop', onDrop, true); } };
}

// Obsidian saveImage hook — save a pasted/dropped blob into the vault's attachment folder and return an embed link.
// Used by both Obsidian hosts (marktile + tugtile's editor modal); the web host passes its own web-upload saveImage instead.
async function saveVaultImage(app, sourcePath, blob) {
  const ext = (blob.type && blob.type.split('/')[1]) || 'png';
  const stamp = (typeof Date !== 'undefined' && Date.now) ? Date.now() : Math.floor(performance.now());
  const path = await app.fileManager.getAvailablePathForAttachment('pasted-' + stamp + '.' + ext, sourcePath || '');
  const file = await app.vault.createBinary(path, await blob.arrayBuffer());
  return '![[' + file.name + ']]';
}

// Obsidian image-insert hook for the toolbar 🖼 button: pick a file → save to the vault → return the SAME canonical
// embed paste/drop produces (![[name]]), so the button and paste are byte-identical. Hosts pass this as opts.pickImage.
function pickVaultImage(app, sourcePath) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; inp.remove();
      if (!f) return resolve(null);
      try { resolve(await saveVaultImage(app, sourcePath, f)); } catch (e) { resolve(null); }
    };
    inp.click();
  });
}
// Canonical video embed — ONE markup for every surface (Obsidian + web), so a post stays portable (publish from
// Obsidian → website renders the same). YouTube/Vimeo → responsive iframe; a direct file → <video>; else a plain link.
function videoEmbed(url) {
  let m;
  if ((m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/)))
    return '<figure class="ej-video"><iframe src="https://www.youtube.com/embed/' + m[1] + '" title="video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></figure>';
  if ((m = url.match(/vimeo\.com\/(\d+)/)))
    return '<figure class="ej-video"><iframe src="https://player.vimeo.com/video/' + m[1] + '" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></figure>';
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) return '<figure class="ej-video"><video src="' + url + '" controls></video></figure>';
  return '<p><a href="' + url + '">' + url + '</a></p>';
}
// Prompt for a video URL → canonical embed (toolbar 🎞 button). Shared by every host as opts.pickVideo.
function promptVideoEmbed() {
  const url = (typeof prompt === 'function') ? prompt(t('edVideoPrompt')) : null;
  const u = url && url.trim();
  return u ? videoEmbed(u) : null;
}


const VIEW_TYPE = 'marktile-editor';

// marktile settings. editorTools: per-button on/off (missing key = on), same convention as tugtile — uncheck
// everything and the toolbar disappears. defaultEditor: opt-in to register marktile as the default .md editor
// (off by default, so Obsidian's native editor stays the no-surprise default).
const DEFAULTS = { editorTools: {}, defaultEditor: false, modes: {}, seasonedColor: false };

// The 3-mode cycle + its decorations live in the shared core (EDITOR_MODES + equipEditor, inlined). settings.modes
// gates which modes appear in the cycle (missing key = on, like editorTools); the picker keeps >=1 on.

// The editor's board-only hooks are no-ops; a .md file never "submits" on Enter (Enter is always a newline).
function makeFileHost(plugin, view) {
  const tools = (plugin && plugin.settings && plugin.settings.editorTools) || {};
  return {
    // ⌘-click on a link. Inside Obsidian the vault already knows how to open both kinds, so this
    // hands each one to the app rather than reimplementing resolution — `[[wiki]]` goes through the
    // same link resolver the rest of Obsidian uses (including "create if missing"), and a URL goes
    // out through the app's own opener so the user's settings about external links still apply.
    openLink(link) {
      const app = plugin && plugin.app;
      if (!app) return;
      const from = (view && view.file) ? view.file.path : '';
      if (link.kind === 'wiki' || link.kind === 'ref') app.workspace.openLinkText(link.target, from, false);
      else if (link.kind === 'url' || link.kind === 'image') window.open(link.target, '_blank');
    },
    _editModalOpen: false,
    freezeBoard() {}, unfreezeBoard() {}, closePopup() {}, consumePendingReload() {},
    attachDatePicker() {}, isSubmitKey() { return false; },
    dateTrigger: '@', timeTrigger: '@@',
    // date/time buttons insert tugtile's kanban-only syntax (meaningless in a plain note) → always off; everything
    // else follows the user's toolbar settings.
    plugin: { settings: { editorTools: Object.assign({}, tools, { date: false, time: false }) } },
  };
}

// A real editor pane for a .md file. TextFileView handles file load/save; we mount the shared editor into it
// and autosave on change. A header action switches the leaf back to Obsidian's native markdown editor.
class MarktileView extends TextFileView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }   // plugin ref → the editor reads its toolbar settings
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return this.file ? this.file.basename : 'marktile'; }
  getIcon() { return 'square-m'; }   // marktile's identity = an 'M' badge (= its Seasoned mode), like tugtile's board = gallery-vertical
  async onOpen() {
    // Header actions register RIGHT-TO-LEFT (addAction renders in reverse), and Obsidian's own ⋯ sits rightmost.
    // Target order L→R: [→ tugtile] [→ Obsidian] [settings] [⋯]. So register settings → Obsidian → tugtile.
    this.addAction('settings', t('mtSettings'), () => { try { this.app.setting.open(); this.app.setting.openTabById(this.plugin.manifest.id); } catch (e) {} });
    this.addAction('file-text', t('mtBackToObsidian'), () => this.toObsidian());   // file-text = the conventional "native markdown" icon (Obsidian/Kanban/Excalidraw all use it)
    // tile-family interop: hand this file off to tugtile (open it as a kanban board), if it's installed (leftmost)
    if (this.app.plugins && this.app.plugins.enabledPlugins && this.app.plugins.enabledPlugins.has('tugtile')) {
      this.addAction('gallery-vertical', t('mtToTugtile'), () => this.toTugtile());
    }
    this.watchHeaderTitle();   // take over the header title (clear the redundant filename, drop in the control strip) — see _buildHeaderCtl
  }
  // ── Header takeover, ported 1:1 from tugtile's BoardView (same CSS classes → identical look). The filename is
  //    redundant (the tab shows it), so it's cleared; the strip = viewcycle + brand/lock. Phone → a content-top
  //    .tugtile__ctlbar (built in setViewData); desktop → injected into the .view-header-title here.
  //    viewcycle cycles the view modes (cycleMode); brand/lock toggles read-only (toggleLock).
  _headerTitleEl() { return this.containerEl ? this.containerEl.querySelector('.view-header-title') : null; }
  decorateHeaderTitle() {
    const el = this._headerTitleEl();
    if (!el) return;
    if (Platform.isPhone) { if (el.textContent !== '') el.textContent = ''; return; }   // Phone: strip lives in the content ctlbar; keep the header title empty
    if (el.querySelector('.tugtile-headerctl')) return;   // Already built; skip (also prevents observer loops). Obsidian wipes it on updateHeader → we rebuild.
    el.textContent = '';
    this._buildHeaderCtl(el);
  }
  watchHeaderTitle() {
    const el = this._headerTitleEl();
    if (!el || this._titleObserver) return;
    this._titleObserver = new MutationObserver(() => this.decorateHeaderTitle());   // Obsidian resets the title on updateHeader → re-apply
    this._titleObserver.observe(el, { childList: true });
    this.decorateHeaderTitle();
  }
  _buildHeaderCtl(parent) {
    const wrap = parent.createSpan({ cls: 'tugtile-headerctl' });
    const vc = wrap.createSpan({ cls: 'tugtile-viewcycle' });   // the view-mode cycle (Seasoned / Rendered / Plain)
    vc.setAttribute('role', 'button');
    vc.setAttribute('aria-label', t('mtModeToggle'));   // cycles the view modes (NOT tugtile's board/table view switch)
    vc.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.cycleMode(); };
    this._viewCycleEl = vc;
    wrap.createSpan({ cls: 'tugtile-sep', text: '·' });
    const lk = wrap.createSpan({ cls: 'tugtile-brand' });   // brand suffix + lock icon = the read-only toggle
    lk.setAttribute('role', 'button');
    lk.setAttribute('aria-label', t('mtLockToggle'));   // locks the EDITOR read-only (marktile has no board)
    lk.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.toggleLock(); };
    this._lockBtnEl = lk;
    this.refreshCtl();
    return wrap;
  }
  refreshCtl() {
    const vc = this._viewCycleEl;
    if (vc && vc.isConnected) {
      vc.empty();
      const _m = this._currentMode();
      setIcon(vc.createSpan({ cls: 'tugtile-viewcycle-icon' }), _m.icon);   // square-m Seasoned · square-pen Rendered · square-code Plain
      vc.createSpan({ cls: 'tugtile-viewcycle-name', text: t(_m.name) });
    }
    const lk = this._lockBtnEl;
    if (lk && lk.isConnected) {
      lk.empty();
      lk.createSpan({ cls: 'tugtile-brand-text', text: this._locked ? t('mtBrandLocked') : t('mtBrand') });
      setIcon(lk.createSpan({ cls: 'tugtile-lock-icon' }), this._locked ? 'lock' : 'lock-open');
    }
  }
  // The view cycle + its decorations are the shared core rig (equipEditor). The view only drives the button:
  // cycleMode advances the rig and remembers the key (restored across a reload); _currentMode feeds refreshCtl.
  _currentMode() {
    return this._rig ? this._rig.currentMode() : EDITOR_MODES[0];
  }
  cycleMode() {
    if (!this._rig) return;
    this._rig.cycleMode();
    this._modeKey = this._rig.currentMode().key;
    this.refreshCtl();
  }
  // Lock: make the editor read-only. Obsidian has no save step (whatever you change IS saved), so this guards
  // against stray edits/taps. Disables the contenteditable + (via CSS) the toolbar.
  toggleLock() {
    this._locked = !this._locked;
    this._applyLock();
    this.refreshCtl();
  }
  _applyLock() {
    const ed = this.contentEl.querySelector('.tugtile-ed-rich');
    if (ed) ed.setAttribute('contenteditable', String(!this._locked));
    this.contentEl.toggleClass('tugtile--locked', !!this._locked);
  }
  // Table of contents: a toggle side panel of H1–H3. The toggle button is added by the shared editor (onToc hook)
  // in the ✕-close slot of marktile's ancestor, tugtile's card modal. Click a heading → scroll the editor to it.
  // TOC = the shared core wireToc (one TOC for marktile + the web host). marktile's extras ride as hooks: the panel pins
  // below the in-flow toolbar (anchorScroll), the phone overlay closes after a jump (onNavigate), and the Sortable
  // gets tugtile's mobile touch tuning (sortableOptions). the rig (this._rig) is (re)created in setViewData after the mount.
  toggleToc(force) { if (this._rig && this._rig.toc) this._rig.toc.toggle(force); }
  _refreshTocSoon() { if (this._rig && this._rig.toc) this._rig.toc.refresh(); }   // shared wireToc no-ops when the panel is closed
  toTugtile() {
    if (!this.file) return;
    this.leaf.setViewState({ type: 'tugtile-board', active: true, state: { file: this.file.path } });
  }
  getViewData() { return this._ctrl ? this._ctrl.rawValue() : this.data; }
  setViewData(data, clear) {
    this.data = data;
    if (this._ctrl) { this._ctrl.destroy(); this._ctrl = null; }
    const _tocWasOpen = this._rig && this._rig.toc ? this._rig.toc.isOpen() : false;   // remember across the rebuild
    if (this._rig) { this._rig.destroy(); this._rig = null; }
    this.contentEl.empty();
    this._ctrl = mountEditor(this.contentEl, { text: data, onChange: () => { this.requestSave(); this._refreshTocSoon(); }, onToc: () => this.toggleToc(), pickImage: () => pickVaultImage(this.app, this.file ? this.file.path : ''), pickVideo: () => promptVideoEmbed() }, makeFileHost(this.plugin, this));
    // mountEditor() empties contentEl, so build the phone control strip AFTER it and prepend above the toolbar.
    if (Platform.isPhone) { const ctl = createDiv({ cls: 'tugtile__ctlbar' }); this._buildHeaderCtl(ctl); this.contentEl.prepend(ctl); }
    this.decorateHeaderTitle();   // desktop: inject into the header title; phone: keep the header filename cleared
    this.contentEl.addClass('marktile-ed');   // scope: marktile IS a markdown editor → monospace font (not tugtile cards)
    this._applyLock();
    // Equip the shared editor rig (mode cycle + in-grid tables + inline images + TOC) on contentEl — the exact same
    // rig tugtile's modal equips. Host hooks: Obsidian vault image resolution, and the TOC's mobile/anchor tuning.
    this._rig = equipEditor({
      mount: this.contentEl, ctrl: this._ctrl,
      enabledModes: (this.plugin.settings && this.plugin.settings.modes) || {},
      seasonedColor: !!(this.plugin.settings && this.plugin.settings.seasonedColor),   // Seasoned palette: accent vs colour
      initialMode: this._modeKey,   // restore the current mode across a reload
      saveImage: (blob) => saveVaultImage(this.app, this.file ? this.file.path : '', blob),   // paste/drop an image → vault attachment + ![[…]]
      resolveSrc: (raw) => {
        raw = String(raw).split('|')[0].trim();
        if (/^(https?:|data:|app:)/i.test(raw)) return raw;
        if (!/\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i.test(raw.split('#')[0])) return null;
        try { const f = this.app.metadataCache.getFirstLinkpathDest(raw, this.file ? this.file.path : ''); return f ? this.app.vault.getResourcePath(f) : null; } catch (e) { return null; }
      },
      toc: {
        Sortable: (typeof Sortable !== 'undefined' ? Sortable : undefined),
        labels: { title: t('mtToc'), empty: t('mtTocEmpty') },
        onReorder: () => this.requestSave(),
        onNavigate: () => { if (Platform.isPhone) this.toggleToc(false); },   // phone overlay closes after a jump
        anchorScroll: '.tugtile-ed-scroll',                                    // pin the panel below the in-flow toolbar
        sortableOptions: { delay: 180, delayOnTouchOnly: true, touchStartThreshold: 8, forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4, dragClass: 'marktile-toc-item--drag' },
      },
    });
    this.refreshCtl();   // viewcycle button reflects the restored mode
    if (_tocWasOpen) this._rig.toc.toggle(true);   // restore the TOC across a reload
  }
  clear() {
    if (this._ctrl) { this._ctrl.destroy(); this._ctrl = null; }
    if (this._rig) { this._rig.destroy(); this._rig = null; }
    this.contentEl.empty();
    this.data = '';
  }
  async onClose() { if (this._rig) { this._rig.destroy(); this._rig = null; } if (this._titleObserver) { this._titleObserver.disconnect(); this._titleObserver = null; } if (this._ctrl) { this._ctrl.destroy(); this._ctrl = null; } }
  toObsidian() {
    if (!this.file) return;
    // tugtile globally hooks setViewState to reclaim board files as boards, so a plain setViewState('markdown')
    // on a board file bounces straight back to tugtile. Use tugtile's sanctioned escape-hatch API when present;
    // fall back to a direct switch when tugtile isn't installed (then there's no hook to dodge).
    const tg = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins['tugtile'];
    if (tg && typeof tg.openAsObsidian === 'function') { tg.openAsObsidian(this.leaf); return; }
    this.leaf.setViewState({ type: 'markdown', active: true, state: { file: this.file.path, mode: 'source' } });
  }
}

// Settings tab: toolbar-button pickers (same style as tugtile; uncheck all → no toolbar) + the default-editor opt-in.
class MarktileSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h3', { text: t('mtSettingsTitle') });
    containerEl.createEl('p', { cls: 'setting-item-description', text: t('mtSettingsDesc') });
    const toolPicker = (name, desc, filter) => new Setting(containerEl).setName(name).setDesc(desc).then((s) => {
      s.controlEl.addClass('tugtile-tools-pick');
      const et = this.plugin.settings.editorTools || (this.plugin.settings.editorTools = {});
      EDITOR_TOOLS.forEach((tk) => {
        if (tk === 'sep' || tk === 'rowbreak' || !filter(tk)) return;
        const lbl = s.controlEl.createEl('label', { cls: 'tugtile-tool-chk' });
        const cb = lbl.createEl('input', { type: 'checkbox' });
        cb.checked = et[tk.key] !== false;
        const glyph = lbl.createSpan({ cls: 'tugtile-tool-chk-i' });
        if (tk.icon) setIcon(glyph, tk.icon); else glyph.textContent = tk.g;   // same icon the toolbar uses
        cb.onchange = async () => { et[tk.key] = cb.checked; await this.plugin.saveSettings(); };
      });
    });
    toolPicker(t('mtEssentialTools'), t('mtEssentialToolsDesc'), (tk) => tk.fixed);             // search / undo / redo
    toolPicker(t('gFormatTools'), t('gFormatToolsDesc'), (tk) => tk.cat === 'format');           // headings / bold / italic / strike
    toolPicker(t('gBlockTools'), t('gBlockToolsDesc'), (tk) => tk.cat === 'block');               // lists / check / quote / table
    toolPicker(t('gInsertTools'), t('mtInsertToolsDesc'), (tk) => tk.cat === 'insert' && tk.key !== 'date' && tk.key !== 'time');   // code / link (date/time are board-only)
    new Setting(containerEl).setName(t('mtModesPick')).setDesc(t('mtModesPickDesc')).then((s) => {
      s.controlEl.addClass('tugtile-tools-pick');
      const md = this.plugin.settings.modes || (this.plugin.settings.modes = {});
      EDITOR_MODES.forEach((m) => {
        const lbl = s.controlEl.createEl('label', { cls: 'tugtile-tool-chk' });
        const cb = lbl.createEl('input', { type: 'checkbox' });
        cb.checked = md[m.key] !== false;
        setIcon(lbl.createSpan({ cls: 'tugtile-tool-chk-i' }), m.icon);
        lbl.createSpan({ text: t(m.name) });
        cb.onchange = async () => {
          const willOn = EDITOR_MODES.filter((x) => (x.key === m.key ? cb.checked : md[x.key] !== false));
          if (!willOn.length) { cb.checked = true; new Notice(t('mtModesMinOne')); return; }   // keep at least one mode in the cycle
          md[m.key] = cb.checked; await this.plugin.saveSettings(); new Notice(t('mtReloadRequired'));
        };
      });
    });
    new Setting(containerEl).setName(t('mtSeasonedColor')).setDesc(t('mtSeasonedColorDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.seasonedColor).onChange(async (v) => {
        this.plugin.settings.seasonedColor = v; await this.plugin.saveSettings(); new Notice(t('mtReloadRequired'));
      }));
    new Setting(containerEl).setName(t('mtDefaultEditor')).setDesc(t('mtDefaultEditorDesc'))
      .addToggle((tg) => tg.setValue(this.plugin.settings.defaultEditor).onChange(async (v) => {
        this.plugin.settings.defaultEditor = v; await this.plugin.saveSettings(); new Notice(t('mtReloadRequired'));
      }));

    // tile family cross-discovery: tell marktile users tugtile exists (even if not installed)
    const hasTg = !!(this.app.plugins && this.app.plugins.enabledPlugins && this.app.plugins.enabledPlugins.has('tugtile'));
    const fam = new Setting(containerEl).setName(t('familyTugtile')).setDesc(hasTg ? t('familyHave') : t('familyTugtileDesc'));
    if (!hasTg) fam.addButton((b) => b.setButtonText(t('familyGet')).onClick(() => window.open('obsidian://show-plugin?id=tugtile')));
  }
}

module.exports = class MarktilePlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this._mdBtns = [];   // injected native-header buttons, tracked so we can remove them on unload
    this.registerView(VIEW_TYPE, (leaf) => new MarktileView(leaf, this));
    this.addSettingTab(new MarktileSettingTab(this.app, this));
    // Opt-in (off by default): make marktile the default editor for .md. Board files still open here too — hop to
    // tugtile with the gallery-vertical button. Toggling needs an Obsidian reload to take effect.
    if (this.settings.defaultEditor) { try { this.registerExtensions(['md'], VIEW_TYPE); } catch (e) {} }
    this.addRibbonIcon('square-m', t('mtRibbon'), () => this.openActiveInMarktile());
    this.addCommand({
      id: 'open-in-marktile',
      name: t('mtOpenCmd'),
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        const ok = !!(f && f.extension === 'md');
        if (ok && !checking) this.openActiveInMarktile();
        return ok;
      },
    });
    // Put an "open in marktile" button on every native markdown editor's header (the Obsidian → marktile hop)
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => this.injectMdButton(leaf)));
    // Also inject into markdown panes already open when marktile loads (active-leaf-change won't fire for them)
    this.app.workspace.onLayoutReady(() => this.app.workspace.getLeavesOfType('markdown').forEach((l) => this.injectMdButton(l)));
  }
  onunload() {
    // Per Obsidian plugin guidelines: do NOT detachLeavesOfType here — Obsidian reinitializes
    // open leaves at their original position on update; detaching ourselves causes problems.
    (this._mdBtns || []).forEach(({ view, el }) => { if (el) el.remove(); if (view) delete view._mtBtn; });   // Remove the buttons we injected into native headers
    this._mdBtns = [];
  }
  async loadSettings() { this.settings = Object.assign({}, DEFAULTS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }
  injectMdButton(leaf) {
    this._mdBtns = (this._mdBtns || []).filter(({ el }) => el && el.isConnected);   // prune entries for closed leaves so dead MarkdownView refs can be GC'd (L3)
    const v = leaf && leaf.view;
    if (!v || typeof v.getViewType !== 'function' || v.getViewType() !== 'markdown' || v._mtBtn) return;
    try {
      const el = v.addAction('square-m', t('mtRibbon'), () => {
        const f = v.file;
        if (f) leaf.setViewState({ type: VIEW_TYPE, active: true, state: { file: f.path } });
      });
      v._mtBtn = el;
      this._mdBtns.push({ view: v, el });
    } catch (e) { /* header injection is best-effort; the command/ribbon are the reliable entry points */ }
  }
  openActiveInMarktile() {
    const f = this.app.workspace.getActiveFile();
    if (!f || f.extension !== 'md') { new Notice(t('mtNoFile')); return; }
    const leaf = this.app.workspace.getLeaf(false);
    leaf.setViewState({ type: VIEW_TYPE, active: true, state: { file: f.path } });
  }
};
